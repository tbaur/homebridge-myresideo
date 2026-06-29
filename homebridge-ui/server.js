'use strict'

/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Homebridge custom UI server for account linking.
 *
 * It wraps the tested OAuth2 Authorization Code helpers in src/api/auth.ts
 * (compiled to dist/) so the plugin settings screen can turn a Consumer
 * Key/Secret plus a pasted authorization code into the refresh/access tokens
 * the plugin needs. The browser plumbing is intentionally minimal: the frontend
 * builds the authorize URL itself and opens the sign-in page, then the user
 * pastes the resulting code (or the full redirect URL) back here to exchange
 * for tokens — which keeps linking working identically whether Homebridge runs
 * locally or on a remote host.
 *
 * No secret is ever logged here; failures are surfaced to the UI as sanitized
 * messages via @link sanitizeError.
 */

const { HomebridgePluginUiServer, RequestError } = require('@homebridge/plugin-ui-utils')
const { exchangeAuthorizationCode, extractAuthorizationCode } = require('../dist/api/auth')
const { sanitizeError } = require('../dist/utils')

const asTrimmedString = value => (typeof value === 'string' ? value.trim() : '')

class ResideoUiServer extends HomebridgePluginUiServer {
  constructor() {
    super()
    // Cheap warm-up endpoint: the frontend pings this on load so the first
    // *real* request (the token exchange) is never the cold-start one.
    // config-ui-x can drop the response to the very first request sent to a
    // freshly spawned child, which otherwise left the "Link account" spinner
    // hanging until a page reload.
    this.onRequest('/ping', () => ({ ok: true }))
    this.onRequest('/exchange-code', payload => this.handleExchangeCode(payload))
    this.ready()
  }

  /**
   * Exchange the pasted authorization code (or full redirect URL) for tokens.
   * Only the resulting tokens are returned; the raw token-endpoint response is
   * never surfaced, and the pasted value is never echoed back on error.
   */
  async handleExchangeCode(payload) {
    const consumerKey = asTrimmedString(payload && payload.consumerKey)
    const consumerSecret = asTrimmedString(payload && payload.consumerSecret)
    const redirectUri = asTrimmedString(payload && payload.redirectUri)
    const pastedValue = asTrimmedString(payload && payload.pastedValue)

    let code
    try {
      code = extractAuthorizationCode(pastedValue)
    } catch (err) {
      throw new RequestError(sanitizeError(err))
    }

    try {
      const tokens = await exchangeAuthorizationCode({ consumerKey, consumerSecret, code, redirectUri })
      // Guard against an unexpected response shape so the UI never saves
      // undefined tokens that would silently break polling after a restart.
      if (!asTrimmedString(tokens && tokens.access_token) || !asTrimmedString(tokens && tokens.refresh_token)) {
        throw new RequestError('Resideo did not return the expected tokens. Please try linking again.')
      }
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
      }
    } catch (err) {
      if (err instanceof RequestError) {
        throw err
      }
      throw new RequestError(sanitizeError(err))
    }
  }
}

(() => new ResideoUiServer())()
