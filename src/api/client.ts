/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview HTTP client for the Resideo / Honeywell Home API.
 *
 * Every API call requires BOTH an OAuth2 bearer token (Authorization header)
 * and the developer `apikey` query parameter. This client injects both,
 * enforces a timeout, retries transient failures with backoff, performs a
 * single token-refresh-and-retry on 401, and gates requests through a circuit
 * breaker so sustained Resideo outages fail fast instead of hammering the API.
 */

import { Buffer } from 'node:buffer'
import { request as httpsRequest } from 'node:https'

import {
  ApiParseError,
  ApiResponseError,
  AuthenticationError,
  CircuitBreakerError,
  createApiError,
  NetworkError,
  RateLimitError,
  TimeoutError,
} from '../errors'
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEVICES_URL,
  LOCATIONS_URL,
  MAX_API_RETRY_ATTEMPTS,
  MAX_RESPONSE_BODY_BYTES,
  WATER_LEAK_DETECTOR_TYPE,
} from '../settings'
import type { PluginLogger, ResideoLocation, WaterLeakDetector } from '../types'
import { backoffMs, delay, parseRetryAfterMs } from '../utils/backoff'
import type { TokenManager } from './auth'
import {
  CircuitBreaker,
  CircuitState,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  type CircuitBreakerConfig,
  type CircuitBreakerStatus,
} from './circuit-breaker'

/** Minimal logger surface; any subset of methods may be provided. */
export type ClientLogger = PluginLogger

/** A raw HTTP response from the low-level transport. */
export interface RawResponse {
  status: number
  body: string
  /** Response headers (lower-cased keys), used to honor `Retry-After` on 429s. */
  headers?: Record<string, string | string[] | undefined>
}

/** A single networked request outcome, reported to the diagnostics collector. */
export interface RequestMetric {
  durationMs: number
  ok: boolean
}

/** Subset of client status exposed to diagnostics. */
export interface ClientStatus {
  circuitBreaker: CircuitBreakerStatus
}

export interface ApiClientOptions {
  tokenManager: TokenManager
  /** Developer API Key, sent as the required `apikey` query parameter. */
  apikey: string
  timeoutMs?: number
  maxRetryAttempts?: number
  /** Optional overrides for the per-client circuit breaker (primarily for tests). */
  circuitBreaker?: Partial<CircuitBreakerConfig>
  logger?: ClientLogger
  /** Injectable transport (primarily for tests). */
  transport?: (url: string, accessToken: string, timeoutMs: number) => Promise<RawResponse>
  /**
   * Optional diagnostics hook invoked once per networked transport attempt with
   * its wall-clock duration and success flag. Never invoked for pre-flight
   * failures (e.g. circuit breaker open, or a token refresh that fails before
   * any request is sent).
   */
  metrics?: (sample: RequestMetric) => void
  /** Optional diagnostics hook invoked each time a request attempt is retried. */
  onRetry?: () => void
  /**
   * Optional hook fired whenever the circuit breaker transitions into the open
   * state, so observers can count trips at the moment they happen.
   */
  onCircuitOpen?: () => void
}

/**
 * Errors that should count against the circuit breaker: server-side and
 * connectivity problems. Client errors (4xx) reflect the request, not service
 * health, and must not trip the breaker.
 */
function isCircuitBreakerFailure(error: unknown): boolean {
  if (
    error instanceof NetworkError
    || error instanceof TimeoutError
    || error instanceof ApiParseError
  ) {
    return true
  }
  if (error instanceof ApiResponseError) {
    return error.httpStatus >= 500 && error.httpStatus < 600
  }
  return false
}

export class ResideoApiClient {
  private readonly tokenManager: TokenManager
  private readonly apikey: string
  private readonly timeoutMs: number
  private readonly maxRetryAttempts: number
  private readonly logger?: ClientLogger
  private readonly transport: (url: string, accessToken: string, timeoutMs: number) => Promise<RawResponse>
  private readonly metrics?: (sample: RequestMetric) => void
  private readonly onRetry?: () => void
  private readonly onCircuitOpen?: () => void
  private readonly circuitBreaker: CircuitBreaker

  constructor(options: ApiClientOptions) {
    this.tokenManager = options.tokenManager
    this.apikey = options.apikey
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.maxRetryAttempts = options.maxRetryAttempts ?? MAX_API_RETRY_ATTEMPTS
    this.logger = options.logger
    this.transport = options.transport ?? defaultTransport
    this.metrics = options.metrics
    this.onRetry = options.onRetry
    this.onCircuitOpen = options.onCircuitOpen
    this.circuitBreaker = new CircuitBreaker({
      ...options.circuitBreaker,
      onStateChange: (from, to) => {
        options.circuitBreaker?.onStateChange?.(from, to)
        this.logCircuitTransition(from, to)
      },
    })
  }

  /** GET all locations (with their embedded devices) for the authenticated user. */
  async getLocations(): Promise<ResideoLocation[]> {
    // Validate the array shape inside get()'s success path (before recordSuccess)
    // so a 200 non-array body counts as a breaker failure, not a success.
    return this.get<ResideoLocation[]>(LOCATIONS_URL, {}, (parsed) => {
      if (!Array.isArray(parsed)) {
        throw new ApiParseError('Locations response was not an array; the API returned an unexpected payload.')
      }
      return parsed
    })
  }

  /** GET a single water leak detector's current status. */
  async getWaterLeakDetector(deviceID: string, locationId: number | string): Promise<WaterLeakDetector> {
    const url = `${DEVICES_URL}/${WATER_LEAK_DETECTOR_TYPE}/${encodeURIComponent(deviceID)}`
    // Validate inside get()'s success path (before recordSuccess) so a 200 with an
    // unusable body is retried and counted as a breaker failure, exactly like
    // getLocations. Without this an HTML/WAF or gateway-error body that happens to
    // parse as JSON would be handed to the accessory as device state.
    return this.get<WaterLeakDetector>(
      url,
      { locationId: String(locationId) },
      parsed => assertWaterLeakDetector(parsed),
    )
  }

  /** Current resilience status (circuit breaker). */
  getStatus(): ClientStatus {
    return {
      circuitBreaker: this.circuitBreaker.getStatus(),
    }
  }

  /** Reset the circuit breaker (primarily for tests). */
  resetCircuitBreaker(): void {
    this.circuitBreaker.reset()
  }

  /**
   * Perform an authenticated GET. Adds `apikey` plus any extra query params,
   * gates through the circuit breaker, retries transient failures, and refreshes
   * the token once on a 401.
   *
   * @param validate Optional post-parse check that runs before the attempt is
   *   counted as a breaker success. Thrown errors are treated as request failures.
   */
  async get<T>(
    baseUrl: string,
    params: Record<string, string>,
    validate?: (parsed: unknown) => T,
  ): Promise<T> {
    const url = this.buildUrl(baseUrl, params)

    // Gate once per logical request — never re-checked mid-retry — so a single
    // call cannot race the breaker open/closed across attempts.
    if (!this.circuitBreaker.canRequest()) {
      const status = this.circuitBreaker.getStatus()
      throw new CircuitBreakerError(
        status.remainingResetTime ?? DEFAULT_CIRCUIT_BREAKER_CONFIG.resetTimeout,
      )
    }

    if (this.circuitBreaker.state === CircuitState.HALF_OPEN) {
      this.circuitBreaker.trackHalfOpenRequest()
    }

    try {
      const { raw, durationMs } = await this.requestWithRetry(url)
      // Parse (and optional validate) after the transport succeeds so a 200 with
      // an unexpected body is counted as a breaker failure, not a success.
      try {
        const parsed = this.parseJson<unknown>(raw, url)
        const value = validate ? validate(parsed) : parsed as T
        this.metrics?.({ durationMs, ok: true })
        this.circuitBreaker.recordSuccess()
        return value
      } catch (err) {
        this.metrics?.({ durationMs, ok: false })
        throw err
      }
    } catch (error) {
      // A single failure is recorded per logical request after retries are
      // exhausted, so retries don't artificially accelerate the breaker.
      // While HALF_OPEN, ANY terminal outcome must release the probe slot
      // (via recordFailure -> OPEN). Otherwise an auth/4xx/429 probe failure
      // would leave halfOpenRequests capped and wedge the breaker forever,
      // suppressing later poll traffic and re-link signaling.
      if (
        this.circuitBreaker.state === CircuitState.HALF_OPEN
        || isCircuitBreakerFailure(error)
      ) {
        this.circuitBreaker.recordFailure()
      }
      throw error
    }
  }

  /**
   * Surface circuit-breaker transitions so operators can see when the Resideo
   * API is being treated as unavailable and when it recovers. OPEN is warn;
   * HALF_OPEN (probe) and CLOSED (recovery) are info.
   */
  private logCircuitTransition(from: CircuitState, to: CircuitState): void {
    const message = `Circuit breaker ${from} -> ${to}`
    if (to === CircuitState.OPEN) {
      this.logger?.warn?.(message)
      this.onCircuitOpen?.()
    } else {
      this.logger?.info?.(message)
    }
  }

  private buildUrl(baseUrl: string, params: Record<string, string>): string {
    const url = new URL(baseUrl)
    url.searchParams.set('apikey', this.apikey)
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
    return url.toString()
  }

  private async requestWithRetry(url: string): Promise<{ raw: RawResponse, durationMs: number }> {
    let lastError: unknown
    let refreshedOnAuth = false

    for (let attempt = 1; attempt <= this.maxRetryAttempts; attempt++) {
      // When the server sends a Retry-After on a 429, honor it instead of the
      // generic backoff for this iteration only.
      let waitMs: number | undefined
      try {
        const accessToken = await this.tokenManager.getAccessToken()
        const { raw, durationMs } = await this.timedTransport(url, accessToken)

        if (raw.status >= 200 && raw.status < 300) {
          return { raw, durationMs }
        }

        const error = createApiError(raw.status, `API request failed: ${raw.status}`)

        // One token refresh-and-retry on auth failure. Decrement `attempt` so
        // the for-loop increment still grants a follow-up transport with the
        // fresh token even when the 401 arrived on the final attempt budget.
        if (error instanceof AuthenticationError && !refreshedOnAuth) {
          refreshedOnAuth = true
          this.logger?.debug?.('Received 401; forcing token refresh and retrying')
          await this.tokenManager.forceRefresh()
          this.onRetry?.()
          attempt--
          continue
        }

        if (!error.isRetryable) {
          throw error
        }
        if (error instanceof RateLimitError) {
          waitMs = parseRetryAfterMs(raw.headers?.['retry-after'])
        }
        lastError = error
      } catch (err) {
        if (err instanceof AuthenticationError) {
          throw err
        }
        const isRetryable = err instanceof NetworkError || err instanceof TimeoutError
        if (!isRetryable) {
          throw err
        }
        lastError = err
      }

      if (attempt < this.maxRetryAttempts) {
        this.onRetry?.()
        await delay(waitMs ?? backoffMs(attempt))
      }
    }

    throw lastError instanceof Error ? lastError : new NetworkError('Request failed after retries')
  }

  /**
   * Invoke the transport and time the attempt. A networked failure (a non-2xx
   * response, or a thrown network/timeout error) records an `ok: false` metric
   * here and is re-thrown/returned for the retry logic. A 2xx response does NOT
   * record here: its metric is deferred to {@link get} so the JSON parse outcome
   * is included, and the measured duration is returned to the caller.
   */
  private async timedTransport(url: string, accessToken: string): Promise<{ raw: RawResponse, durationMs: number }> {
    const startedAt = Date.now()
    try {
      const raw = await this.transport(url, accessToken, this.timeoutMs)
      const durationMs = Date.now() - startedAt
      if (raw.status < 200 || raw.status >= 300) {
        this.metrics?.({ durationMs, ok: false })
      }
      return { raw, durationMs }
    } catch (err) {
      this.metrics?.({ durationMs: Date.now() - startedAt, ok: false })
      throw err
    }
  }

  private parseJson<T>(raw: RawResponse, url: string): T {
    try {
      return JSON.parse(raw.body) as T
    } catch (err) {
      throw new ApiParseError(`Failed to parse response from ${describeUrl(url)}`, { cause: err as Error })
    }
  }
}

/**
 * Narrow a parsed detector payload to a usable {@link WaterLeakDetector}.
 *
 * `deviceID` is load-bearing far beyond this response: the platform uses it as the
 * accessory UUID seed, the handler-map key, and the test for whether a cached
 * accessory is a real detector or a corrupt entry to prune. A 200 body without one
 * (`null`, `{}`, a gateway error object) would therefore be cached as device state
 * and later cause the accessory to be unregistered from HomeKit, so it is rejected
 * here as a retryable parse failure instead.
 */
function assertWaterLeakDetector(parsed: unknown): WaterLeakDetector {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiParseError('Detector response was not an object; the API returned an unexpected payload.')
  }
  const device = parsed as WaterLeakDetector
  if (typeof device.deviceID !== 'string' || device.deviceID === '') {
    throw new ApiParseError('Detector response did not include a deviceID; the API returned an unexpected payload.')
  }
  return device
}

/** Path-only URL description for error messages (never includes query/secrets). */
function describeUrl(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return 'API'
  }
}

/** Default transport using Node's native https with a timeout. */
function defaultTransport(url: string, accessToken: string, timeoutMs: number): Promise<RawResponse> {
  return new Promise<RawResponse>((resolve, reject) => {
    const target = new URL(url)
    const req = httpsRequest(
      target,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = []
        let total = 0
        res.on('data', (chunk) => {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          total += buf.length
          if (total > MAX_RESPONSE_BODY_BYTES) {
            // Tear down the response stream as well as the request so the
            // underlying socket is released immediately instead of lingering.
            res.destroy()
            req.destroy()
            reject(new NetworkError(`Response body exceeded the ${MAX_RESPONSE_BODY_BYTES}-byte limit`))
            return
          }
          chunks.push(buf)
        })
        res.on('end', () => resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
          headers: res.headers,
        }))
      },
    )
    req.on('timeout', () => {
      req.destroy()
      reject(new TimeoutError(`Request timed out after ${timeoutMs}ms`))
    })
    req.on('error', err => reject(new NetworkError(`Request failed: ${err.message}`, { cause: err })))
    req.end()
  })
}
