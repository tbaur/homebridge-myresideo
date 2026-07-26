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
 * Key/Secret plus a pasted redirect URL into the refresh/access tokens the
 * plugin needs. The UI asks `/build-authorize-url` (shared `buildAuthorizeUrl`
 * + `state`) before opening Resideo sign-in; the server retains the CSRF
 * `state` in memory and verifies it on `/exchange-code` so the browser never
 * stores it. The user pastes the full redirect URL back to finish linking —
 * which works identically whether Homebridge runs locally or on a remote host.
 *
 * No secret is ever logged here; failures are surfaced to the UI as sanitized
 * messages via @link sanitizeError.
 */

const { HomebridgePluginUiServer, RequestError } = require('@homebridge/plugin-ui-utils')
const { AUTHORIZE_URL } = require('../dist/settings')
const { sanitizeError } = require('../dist/utils')
const {
  PendingOAuthState,
  buildAuthorizeUrlResponse,
  exchangeCode,
} = require('./handlers')

class ResideoUiServer extends HomebridgePluginUiServer {
  constructor() {
    super()
    this.pendingOAuthState = new PendingOAuthState()
    this.onRequest('/oauth-meta', () => this.handleOAuthMeta())
    this.onRequest('/build-authorize-url', payload => this.handleBuildAuthorizeUrl(payload))
    this.onRequest('/exchange-code', payload => this.handleExchangeCode(payload))
    this.ready()
  }

  /** Shared OAuth constants so the browser UI does not hardcode the authorize host. */
  handleOAuthMeta() {
    return { authorizeUrl: AUTHORIZE_URL }
  }

  /**
   * Build an authorize URL with a fresh CSRF `state` via the shared auth helper.
   * The UI opens a blank popup on click, then navigates it here so the popup
   * stays tied to the user gesture while URL construction stays server-side.
   * The `state` is retained on this server process and is not returned to the
   * browser (it is already embedded in the authorize URL for the redirect).
   */
  handleBuildAuthorizeUrl(payload) {
    try {
      const built = buildAuthorizeUrlResponse(payload)
      this.pendingOAuthState.set(built.state)
      return { authorizeUrl: built.authorizeUrl }
    } catch (err) {
      throw new RequestError(sanitizeError(err))
    }
  }

  /**
   * Exchange the pasted full redirect URL for tokens. CSRF `state` is taken
   * from the in-memory value set by `/build-authorize-url` (consumed once).
   * Only the resulting tokens are returned; the raw token-endpoint response is
   * never surfaced, and the pasted value is never echoed on error.
   */
  async handleExchangeCode(payload) {
    const expectedState = this.pendingOAuthState.take()
    if (!expectedState) {
      throw new RequestError(
        'Linking state is missing. Click Open Resideo sign-in again, then paste the full redirect URL.',
      )
    }
    try {
      return await exchangeCode({ ...payload, expectedState })
    } catch (err) {
      throw new RequestError(sanitizeError(err))
    }
  }
}

(() => new ResideoUiServer())()
