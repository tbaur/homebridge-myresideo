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
 *   - refreshes proactively, a buffer before expiry, so polls never race expiry;
 *   - collapses concurrent refreshes into a single in-flight request;
 *   - surfaces a typed {@link RefreshTokenInvalidError} on `invalid_grant`;
 *   - persists the rotated refresh token via {@link TokenManagerOptions.onRefreshToken}.
 */

import { Buffer } from 'node:buffer'
import { request as httpsRequest } from 'node:https'

import { ApiParseError, NetworkError, RefreshTokenInvalidError } from '../errors'
import { DEFAULT_TOKEN_TTL_SEC, TOKEN_REFRESH_BUFFER_MS, TOKEN_URL } from '../settings'
import type { TokenResponse } from '../types'

/** Minimal logger surface; any subset of methods may be provided. */
export interface AuthLogger {
  debug?: (message: string) => void
  warn?: (message: string) => void
  error?: (message: string) => void
}

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

  private readonly consumerKey: string
  private readonly consumerSecret: string
  private readonly onRefreshToken?: (token: string) => Promise<void> | void
  private readonly logger?: AuthLogger
  private readonly now: () => number
  private readonly requestToken: (formBody: string, basicAuth: string) => Promise<TokenResponse>

  constructor(options: TokenManagerOptions) {
    this.consumerKey = options.consumerKey
    this.consumerSecret = options.consumerSecret
    this.refreshToken = options.refreshToken
    this.accessToken = options.accessToken ?? null
    this.onRefreshToken = options.onRefreshToken
    this.logger = options.logger
    this.now = options.now ?? Date.now
    this.requestToken = options.requestToken ?? defaultRequestToken
  }

  /**
   * Return a valid access token, refreshing proactively if the current token is
   * missing or within the refresh buffer of expiring. Concurrent callers share
   * a single refresh.
   */
  async getAccessToken(): Promise<string> {
    if (this.accessToken && this.now() < this.expiresAt) {
      return this.accessToken
    }
    return this.refresh()
  }

  /** Force a refresh regardless of the current token's expiry. */
  async forceRefresh(): Promise<string> {
    this.expiresAt = 0
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

    const basicAuth = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64')
    const formBody = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
    }).toString()

    this.refreshInFlight = this.requestToken(formBody, basicAuth)
      .then(async (token) => {
        this.applyToken(token)
        if (token.refresh_token && token.refresh_token !== this.refreshToken) {
          this.refreshToken = token.refresh_token
          await this.onRefreshToken?.(token.refresh_token)
          this.logger?.debug?.('Refresh token rotated and persisted')
        }
        return this.accessToken as string
      })
      .finally(() => {
        this.refreshInFlight = null
      })

    return this.refreshInFlight
  }

  private applyToken(token: TokenResponse): void {
    const ttlSec = Number(token.expires_in) || DEFAULT_TOKEN_TTL_SEC
    this.accessToken = token.access_token
    this.expiresAt = this.now() + ttlSec * 1000 - TOKEN_REFRESH_BUFFER_MS
  }
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
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          const status = res.statusCode ?? 0
          if (status === 400 || status === 401) {
            reject(new RefreshTokenInvalidError(`Token refresh rejected (${status}): ${raw}`))
            return
          }
          if (status >= 400) {
            reject(new NetworkError(`Token endpoint returned status ${status}`))
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
    req.on('error', err => reject(new NetworkError(`Token request failed: ${err.message}`, { cause: err })))
    req.write(formBody)
    req.end()
  })
}
