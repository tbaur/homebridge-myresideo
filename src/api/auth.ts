/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview OAuth2 token manager for the Resideo / Honeywell Home API.
 *
 * Resideo issues short-lived access tokens (~30 min) alongside a rotating
 * refresh token. This manager:
 *   - uses a config-supplied access token optimistically once, then refreshes;
 *   - refreshes proactively, a buffer before expiry, so polls never race expiry;
 *   - collapses concurrent refreshes into a single in-flight request;
 *   - retries transient (network/timeout) refresh failures with backoff;
 *   - distinguishes an invalid refresh token from rejected API credentials;
 *   - persists the rotated refresh token via {@link TokenManagerOptions.onRefreshToken}.
 */

import { Buffer } from 'node:buffer'
import { request as httpsRequest } from 'node:https'

import {
  ApiParseError,
  ConfigurationError,
  NetworkError,
  RefreshTokenInvalidError,
  TimeoutError,
  ValidationError,
} from '../errors'
import {
  AUTHORIZE_URL,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_TOKEN_TTL_SEC,
  MAX_TOKEN_REFRESH_ATTEMPTS,
  MIN_TOKEN_LIFETIME_MS,
  TOKEN_REFRESH_BUFFER_MS,
  TOKEN_URL,
} from '../settings'
import type { PluginLogger, TokenResponse } from '../types'
import { backoffMs, delay } from '../utils/backoff'

/** Minimal logger surface; any subset of methods may be provided. */
export type AuthLogger = PluginLogger

export interface TokenManagerOptions {
  consumerKey: string
  consumerSecret: string
  refreshToken: string
  /** Optional starting access token (e.g. restored from config). */
  accessToken?: string
  /** Invoked whenever the API rotates the refresh token, so it can be persisted. */
  onRefreshToken?: (newRefreshToken: string) => Promise<void> | void
  logger?: AuthLogger
  /** Injectable clock (ms epoch). Defaults to {@link Date.now}. */
  now?: () => number
  /** Maximum refresh attempts on transient failures. */
  maxRefreshAttempts?: number
  /**
   * Injectable token-endpoint requester (primarily for tests). Receives the
   * url-encoded form body and the Basic auth header value.
   */
  requestToken?: (formBody: string, basicAuth: string) => Promise<TokenResponse>
}

export class TokenManager {
  private accessToken: string | null
  private refreshToken: string
  private expiresAt = 0
  private refreshInFlight: Promise<string> | null = null
  /**
   * True while a config-supplied access token (whose true expiry is unknown)
   * may still be used. Cleared the first time we refresh, after which the
   * normal proactive-expiry lifecycle takes over.
   */
  private accessTokenIsOptimistic: boolean

  private readonly consumerKey: string
  private readonly consumerSecret: string
  private readonly onRefreshToken?: (token: string) => Promise<void> | void
  private readonly logger?: AuthLogger
  private readonly now: () => number
  private readonly maxRefreshAttempts: number
  private readonly requestToken: (formBody: string, basicAuth: string) => Promise<TokenResponse>

  constructor(options: TokenManagerOptions) {
    this.consumerKey = options.consumerKey
    this.consumerSecret = options.consumerSecret
    this.refreshToken = options.refreshToken
    this.accessToken = options.accessToken ?? null
    this.accessTokenIsOptimistic = Boolean(options.accessToken)
    this.onRefreshToken = options.onRefreshToken
    this.logger = options.logger
    this.now = options.now ?? Date.now
    this.maxRefreshAttempts = options.maxRefreshAttempts ?? MAX_TOKEN_REFRESH_ATTEMPTS
    this.requestToken = options.requestToken ?? defaultRequestToken
  }

  /**
   * Return a valid access token, refreshing proactively if the current token is
   * missing or within the refresh buffer of expiring. A config-supplied token is
   * used optimistically once. Concurrent callers share a single refresh.
   */
  async getAccessToken(): Promise<string> {
    if (this.accessToken && this.now() < this.expiresAt) {
      return this.accessToken
    }
    // A config-supplied token (unknown expiry) is used exactly once; thereafter
    // the normal proactive-expiry lifecycle drives refreshes.
    if (this.accessToken && this.accessTokenIsOptimistic) {
      this.accessTokenIsOptimistic = false
      return this.accessToken
    }
    return this.refresh()
  }

  /** Force a refresh regardless of the current token's expiry. */
  async forceRefresh(): Promise<string> {
    this.expiresAt = 0
    this.accessTokenIsOptimistic = false
    return this.refresh()
  }

  /** The current (possibly rotated) refresh token. */
  getRefreshToken(): string {
    return this.refreshToken
  }

  private refresh(): Promise<string> {
    if (this.refreshInFlight) {
      return this.refreshInFlight
    }

    // Any refresh supersedes the optimistic config token.
    this.accessTokenIsOptimistic = false

    const basicAuth = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64')
    const formBody = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
    }).toString()

    this.refreshInFlight = this.performRefresh(formBody, basicAuth)
      .finally(() => {
        this.refreshInFlight = null
      })

    return this.refreshInFlight
  }

  /**
   * Execute the refresh, retrying transient (network/timeout) failures with
   * exponential backoff. Auth/parse failures are surfaced immediately.
   */
  private async performRefresh(formBody: string, basicAuth: string): Promise<string> {
    let lastError: unknown
    for (let attempt = 1; attempt <= this.maxRefreshAttempts; attempt++) {
      try {
        const token = await this.requestToken(formBody, basicAuth)
        this.applyToken(token)
        if (token.refresh_token && token.refresh_token !== this.refreshToken) {
          this.refreshToken = token.refresh_token
          await this.onRefreshToken?.(token.refresh_token)
          this.logger?.debug?.('Refresh token rotated and persisted')
        }
        return this.accessToken as string
      } catch (err) {
        const isRetryable = err instanceof NetworkError || err instanceof TimeoutError
        if (!isRetryable || attempt === this.maxRefreshAttempts) {
          throw err
        }
        lastError = err
        this.logger?.debug?.(`Token refresh attempt ${attempt} failed (retryable); backing off`)
        await delay(backoffMs(attempt))
      }
    }
    throw lastError instanceof Error ? lastError : new NetworkError('Token refresh failed')
  }

  private applyToken(token: TokenResponse): void {
    const ttlSec = Number(token.expires_in) || DEFAULT_TOKEN_TTL_SEC
    // Floor the usable lifetime so a pathologically short TTL (≤ the refresh
    // buffer) can't make a brand-new token look already-expired and stampede
    // the auth endpoint on every getAccessToken call.
    const lifetimeMs = Math.max(ttlSec * 1000 - TOKEN_REFRESH_BUFFER_MS, MIN_TOKEN_LIFETIME_MS)
    this.accessToken = token.access_token
    this.expiresAt = this.now() + lifetimeMs
  }
}

/** A token-endpoint requester (overridable in tests). */
export type RequestToken = (formBody: string, basicAuth: string) => Promise<TokenResponse>

export interface AuthorizationCodeExchangeOptions {
  /** Developer-app API Key (`client_id`). */
  consumerKey: string
  /** Developer-app API Secret. */
  consumerSecret: string
  /** The one-time `code` returned to the redirect URI by the authorize step. */
  code: string
  /** Must byte-for-byte match the redirect URI registered with the developer app. */
  redirectUri: string
  /** Injectable token-endpoint requester (primarily for tests). */
  requestToken?: RequestToken
}

/**
 * Build the browser authorize URL for the OAuth2 Authorization Code flow.
 *
 * The user opens this URL, signs in, and approves access; Resideo then redirects
 * to `redirectUri?code=...`. Used by the `get-tokens` helper script.
 */
export function buildAuthorizeUrl(consumerKey: string, redirectUri: string): string {
  if (!consumerKey) {
    throw new ValidationError('consumerKey is required to build the authorize URL')
  }
  if (!redirectUri) {
    throw new ValidationError('redirectUri is required to build the authorize URL')
  }
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', consumerKey)
  url.searchParams.set('redirect_uri', redirectUri)
  return url.toString()
}

/**
 * Pull the one-time authorization `code` out of whatever the user pastes back
 * after approving access in the browser. Accepts either the bare `code` or the
 * full redirect URL (e.g. `http://localhost:8581/oauth/callback?code=...&...`),
 * so the account-linking UI can be forgiving about exactly what is pasted.
 *
 * Throws a {@link ValidationError} when no usable code is present, or when the
 * URL carries an OAuth `error` instead of a code. The pasted value (which may
 * contain a code) is never echoed back in the thrown message.
 */
export function extractAuthorizationCode(input: string): string {
  const trimmed = typeof input === 'string' ? input.trim() : ''
  if (!trimmed) {
    throw new ValidationError('Paste the authorization code, or the full redirect URL, to finish linking.')
  }

  if (/^https?:\/\//i.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(trimmed)
    } catch {
      throw new ValidationError('The pasted redirect URL is not a valid URL.')
    }
    const oauthError = parsed.searchParams.get('error')
    if (oauthError) {
      throw new ValidationError(`Authorization was denied or failed (${oauthError}). Try linking again.`)
    }
    const code = parsed.searchParams.get('code')
    if (!code) {
      throw new ValidationError('The pasted redirect URL did not contain an authorization code.')
    }
    return code
  }

  // A bare value: reject anything with embedded whitespace, which means the
  // user pasted surrounding text rather than just the code.
  if (/\s/.test(trimmed)) {
    throw new ValidationError('The authorization code should be a single value with no spaces.')
  }
  return trimmed
}

/**
 * Exchange a one-time authorization `code` for the initial access/refresh token
 * pair (the `grant_type=authorization_code` leg of the OAuth2 flow). This is the
 * tested core of the `get-tokens` helper; the returned `refresh_token` is what a
 * user pastes into the plugin config.
 *
 * Error mapping (invalid_grant, invalid_client, etc.) is shared with token
 * refresh via {@link defaultRequestToken}, so failures surface as the same typed
 * errors and the raw response body is never logged.
 */
export async function exchangeAuthorizationCode(
  options: AuthorizationCodeExchangeOptions,
): Promise<TokenResponse> {
  const { consumerKey, consumerSecret, code, redirectUri } = options
  if (!consumerKey || !consumerSecret) {
    throw new ValidationError('consumerKey and consumerSecret are required')
  }
  if (!code) {
    throw new ValidationError('Authorization code is required')
  }
  if (!redirectUri) {
    throw new ValidationError('redirectUri is required')
  }

  const requestToken = options.requestToken ?? defaultRequestToken
  const basicAuth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')
  const formBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  }).toString()

  return requestToken(formBody, basicAuth)
}

/**
 * Default token-endpoint requester using Node's native https. POSTs a
 * url-encoded form with a Basic auth header, per the Honeywell Home OAuth2 spec.
 */
function defaultRequestToken(formBody: string, basicAuth: string): Promise<TokenResponse> {
  return new Promise<TokenResponse>((resolve, reject) => {
    const url = new URL(TOKEN_URL)
    const req = httpsRequest(
      url,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': String(Buffer.byteLength(formBody)),
        },
        timeout: DEFAULT_REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          const status = res.statusCode ?? 0
          if (status >= 400) {
            reject(mapTokenError(status, raw))
            return
          }
          try {
            resolve(JSON.parse(raw) as TokenResponse)
          } catch (err) {
            reject(new ApiParseError('Failed to parse token response', { cause: err as Error }))
          }
        })
      },
    )
    req.on('timeout', () => {
      req.destroy()
      reject(new TimeoutError(`Token request timed out after ${DEFAULT_REQUEST_TIMEOUT_MS}ms`))
    })
    req.on('error', err => reject(new NetworkError(`Token request failed: ${err.message}`, { cause: err })))
    req.write(formBody)
    req.end()
  })
}

/**
 * Map a non-2xx token-endpoint response to a typed error. Distinguishes an
 * expired/invalid refresh token (user must re-link) from rejected developer
 * credentials (user must fix the API key/secret). The raw response body is NOT
 * embedded, to avoid leaking token material into logs.
 */
function mapTokenError(status: number, rawBody: string): Error {
  const oauthError = parseOAuthError(rawBody)

  if (oauthError === 'invalid_grant') {
    return new RefreshTokenInvalidError()
  }
  if (status === 401 || oauthError === 'invalid_client' || oauthError === 'unauthorized_client') {
    return new ConfigurationError(
      'Resideo rejected the API credentials. Verify the Consumer Key and Secret in the plugin settings.',
    )
  }
  if (status >= 500) {
    return new NetworkError(`Token endpoint returned status ${status}`)
  }
  // Any other 4xx: treat as a re-link condition rather than guessing.
  return new RefreshTokenInvalidError(
    `Token refresh was rejected (HTTP ${status}); re-link your account in the plugin settings.`,
  )
}

/** Best-effort extraction of the OAuth2 `error` code from a response body. */
function parseOAuthError(rawBody: string): string | undefined {
  try {
    const parsed = JSON.parse(rawBody) as { error?: unknown }
    return typeof parsed.error === 'string' ? parsed.error : undefined
  } catch {
    return undefined
  }
}
