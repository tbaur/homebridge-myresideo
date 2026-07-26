'use strict'

/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Pure OAuth helpers for the Homebridge custom UI server.
 * Kept separate from the plugin-ui-utils bootstrap so unit tests can exercise
 * authorize-URL construction and code exchange without spawning a UI server.
 */

const {
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  extractAuthorizationCode,
  generateOAuthState,
} = require('../dist/api/auth')
const { sanitizeError } = require('../dist/utils')

const asTrimmedString = value => (typeof value === 'string' ? value.trim() : '')

/**
 * Build an authorize URL with a fresh CSRF `state` via the shared auth helper.
 * @param {{ consumerKey?: unknown, redirectUri?: unknown }} payload
 * @returns {{ authorizeUrl: string, state: string }}
 */
function buildAuthorizeUrlResponse(payload) {
  const consumerKey = asTrimmedString(payload && payload.consumerKey)
  const redirectUri = asTrimmedString(payload && payload.redirectUri)
  const state = generateOAuthState()
  return {
    authorizeUrl: buildAuthorizeUrl(consumerKey, redirectUri, state),
    state,
  }
}

/**
 * Exchange a pasted redirect URL for tokens. `expectedState` is required so
 * CSRF verification cannot fail open when sessionStorage is empty.
 *
 * @param {{
 *   consumerKey?: unknown,
 *   consumerSecret?: unknown,
 *   redirectUri?: unknown,
 *   pastedValue?: unknown,
 *   expectedState?: unknown,
 * }} payload
 * @param {{
 *   extractAuthorizationCode?: typeof extractAuthorizationCode,
 *   exchangeAuthorizationCode?: typeof exchangeAuthorizationCode,
 * }} [deps]
 * @returns {Promise<{ accessToken: string, refreshToken: string }>}
 */
async function exchangeCode(payload, deps = {}) {
  const extract = deps.extractAuthorizationCode || extractAuthorizationCode
  const exchange = deps.exchangeAuthorizationCode || exchangeAuthorizationCode

  const consumerKey = asTrimmedString(payload && payload.consumerKey)
  const consumerSecret = asTrimmedString(payload && payload.consumerSecret)
  const redirectUri = asTrimmedString(payload && payload.redirectUri)
  const pastedValue = asTrimmedString(payload && payload.pastedValue)
  const expectedState = asTrimmedString(payload && payload.expectedState)

  if (!expectedState) {
    throw new Error(
      'Linking state is missing. Start sign-in again and paste the full redirect URL.',
    )
  }

  let code
  try {
    code = extract(pastedValue, expectedState)
  } catch (err) {
    throw new Error(sanitizeError(err))
  }

  try {
    const tokens = await exchange({ consumerKey, consumerSecret, code, redirectUri })
    if (!asTrimmedString(tokens && tokens.access_token) || !asTrimmedString(tokens && tokens.refresh_token)) {
      throw new Error('Resideo did not return the expected tokens. Please try linking again.')
    }
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
    }
  } catch (err) {
    throw new Error(sanitizeError(err))
  }
}

module.exports = {
  asTrimmedString,
  buildAuthorizeUrlResponse,
  exchangeCode,
}
