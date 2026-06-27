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
 * enforces a timeout, retries transient failures with backoff, and performs a
 * single token-refresh-and-retry on 401.
 */

import { Buffer } from 'node:buffer'
import { request as httpsRequest } from 'node:https'

import { AuthenticationError, ApiParseError, createApiError, NetworkError, TimeoutError } from '../errors'
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEVICES_URL,
  LOCATIONS_URL,
  WATER_LEAK_DETECTOR_TYPE,
} from '../settings'
import type { ResideoLocation, WaterLeakDetector } from '../types'
import type { TokenManager } from './auth'

export interface ClientLogger {
  debug?: (message: string) => void
  warn?: (message: string) => void
  error?: (message: string) => void
}

/** A raw HTTP response from the low-level transport. */
export interface RawResponse {
  status: number
  body: string
}

export interface ApiClientOptions {
  tokenManager: TokenManager
  /** Developer API Key, sent as the required `apikey` query parameter. */
  apikey: string
  timeoutMs?: number
  maxRetryAttempts?: number
  logger?: ClientLogger
  /** Injectable transport (primarily for tests). */
  transport?: (url: string, accessToken: string, timeoutMs: number) => Promise<RawResponse>
}

export class ResideoApiClient {
  private readonly tokenManager: TokenManager
  private readonly apikey: string
  private readonly timeoutMs: number
  private readonly maxRetryAttempts: number
  private readonly logger?: ClientLogger
  private readonly transport: (url: string, accessToken: string, timeoutMs: number) => Promise<RawResponse>

  constructor(options: ApiClientOptions) {
    this.tokenManager = options.tokenManager
    this.apikey = options.apikey
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.maxRetryAttempts = options.maxRetryAttempts ?? 3
    this.logger = options.logger
    this.transport = options.transport ?? defaultTransport
  }

  /** GET all locations (with their embedded devices) for the authenticated user. */
  async getLocations(): Promise<ResideoLocation[]> {
    return this.get<ResideoLocation[]>(LOCATIONS_URL, {})
  }

  /** GET a single water leak detector's current status. */
  async getWaterLeakDetector(deviceID: string, locationId: number | string): Promise<WaterLeakDetector> {
    const url = `${DEVICES_URL}/${WATER_LEAK_DETECTOR_TYPE}/${encodeURIComponent(deviceID)}`
    return this.get<WaterLeakDetector>(url, { locationId: String(locationId) })
  }

  /**
   * Perform an authenticated GET. Adds `apikey` plus any extra query params,
   * retries transient failures, and refreshes the token once on a 401.
   */
  async get<T>(baseUrl: string, params: Record<string, string>): Promise<T> {
    const url = this.buildUrl(baseUrl, params)
    const raw = await this.requestWithRetry(url)
    return this.parseJson<T>(raw, url)
  }

  private buildUrl(baseUrl: string, params: Record<string, string>): string {
    const url = new URL(baseUrl)
    url.searchParams.set('apikey', this.apikey)
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
    return url.toString()
  }

  private async requestWithRetry(url: string): Promise<RawResponse> {
    let lastError: unknown
    let refreshedOnAuth = false

    for (let attempt = 1; attempt <= this.maxRetryAttempts; attempt++) {
      try {
        const accessToken = await this.tokenManager.getAccessToken()
        const raw = await this.transport(url, accessToken, this.timeoutMs)

        if (raw.status >= 200 && raw.status < 300) {
          return raw
        }

        const error = createApiError(raw.status, `Request to ${redact(url)} failed (${raw.status})`)

        // One token refresh-and-retry on auth failure.
        if (error instanceof AuthenticationError && !refreshedOnAuth) {
          refreshedOnAuth = true
          this.logger?.debug?.('Received 401; forcing token refresh and retrying')
          await this.tokenManager.forceRefresh()
          continue
        }

        if (!error.isRetryable) {
          throw error
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
        await delay(backoffMs(attempt))
      }
    }

    throw lastError instanceof Error ? lastError : new NetworkError('Request failed after retries')
  }

  private parseJson<T>(raw: RawResponse, url: string): T {
    try {
      return JSON.parse(raw.body) as T
    } catch (err) {
      throw new ApiParseError(`Failed to parse response from ${redact(url)}`, { cause: err as Error })
    }
  }
}

/** Exponential backoff with a small base; attempt is 1-indexed. */
function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 8000)
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Strip the apikey from a URL before logging. */
function redact(url: string): string {
  try {
    const u = new URL(url)
    if (u.searchParams.has('apikey')) {
      u.searchParams.set('apikey', '***')
    }
    return u.toString()
  } catch {
    return url
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
        res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
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
