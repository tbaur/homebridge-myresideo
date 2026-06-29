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
 * opens the authorize page and the user pastes the resulting code (or the full
 * redirect URL) back, which keeps linking working identically whether
 * Homebridge runs locally or on a remote host.
 *
 * No secret is ever logged here; failures are surfaced to the UI as sanitized
 * messages via @link sanitizeError.
 */

const { HomebridgePluginUiServer, RequestError } = require('@homebridge/plugin-ui-utils')
const { buildAuthorizeUrl, exchangeAuthorizationCode, extractAuthorizationCode } = require('../dist/api/auth')
const { sanitizeError } = require('../dist/utils')

const asTrimmedString = value => (typeof value === 'string' ? value.trim() : '')

class ResideoUiServer extends HomebridgePluginUiServer {
  constructor() {
    super()
    this.onRequest('/authorize-url', payload => this.handleAuthorizeUrl(payload))
    this.onRequest('/exchange-code', payload => this.handleExchangeCode(payload))
    this.ready()
  }

  /** Build the browser authorize URL for the given Consumer Key + redirect URI. */
  handleAuthorizeUrl(payload) {
    const consumerKey = asTrimmedString(payload && payload.consumerKey)
    const redirectUri = asTrimmedString(payload && payload.redirectUri)
    try {
      return { authorizeUrl: buildAuthorizeUrl(consumerKey, redirectUri) }
    } catch (err) {
      throw new RequestError(sanitizeError(err))
    }
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
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
      }
    } catch (err) {
      throw new RequestError(sanitizeError(err))
    }
  }
}

(() => new ResideoUiServer())()
