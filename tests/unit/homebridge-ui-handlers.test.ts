/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Unit tests for homebridge-ui OAuth handlers (require compiled dist/).
 */

import { AUTHORIZE_URL } from '../../src/settings'

// Handlers load compiled dist helpers (same path the UI server uses at runtime).
const { PendingOAuthState, buildAuthorizeUrlResponse, exchangeCode } = require('../../homebridge-ui/handlers') as {
  PendingOAuthState: new (this: void) => { set: (state: string) => void, take: () => string | null }
  buildAuthorizeUrlResponse: (payload: { consumerKey?: string, redirectUri?: string }) => {
    authorizeUrl: string
    state: string
  }
  exchangeCode: (
    payload: Record<string, unknown>,
    deps?: {
      extractAuthorizationCode?: (input: string, expectedState?: string) => string
      exchangeAuthorizationCode?: (opts: Record<string, unknown>) => Promise<{
        access_token?: string
        refresh_token?: string
      }>
    },
  ) => Promise<{ accessToken: string, refreshToken: string }>
}

describe('homebridge-ui handlers', () => {
  describe('PendingOAuthState', () => {
    it('returns and clears a remembered state once', () => {
      const pending = new PendingOAuthState()
      pending.set('opaque-state')
      expect(pending.take()).toBe('opaque-state')
      expect(pending.take()).toBeNull()
    })

    it('ignores empty values', () => {
      const pending = new PendingOAuthState()
      pending.set('')
      expect(pending.take()).toBeNull()
    })
  })

  describe('buildAuthorizeUrlResponse', () => {
    it('returns a shared authorize URL that includes state', () => {
      const result = buildAuthorizeUrlResponse({
        consumerKey: 'my-key',
        redirectUri: 'http://localhost:8581/oauth/callback',
      })
      const url = new URL(result.authorizeUrl)
      expect(`${url.origin}${url.pathname}`).toBe(AUTHORIZE_URL)
      expect(url.searchParams.get('client_id')).toBe('my-key')
      expect(url.searchParams.get('state')).toBe(result.state)
      expect(result.state.length).toBeGreaterThanOrEqual(16)
    })
  })

  describe('exchangeCode', () => {
    it('rejects when expectedState is missing (no fail-open)', async () => {
      await expect(
        exchangeCode({
          consumerKey: 'k',
          consumerSecret: 's',
          redirectUri: 'http://localhost/cb',
          pastedValue: 'http://localhost/cb?code=abc&state=s1',
        }),
      ).rejects.toThrow(/Linking state is missing/)
    })

    it('rejects when expectedState does not match the redirect', async () => {
      await expect(
        exchangeCode({
          consumerKey: 'k',
          consumerSecret: 's',
          redirectUri: 'http://localhost/cb',
          pastedValue: 'http://localhost/cb?code=abc&state=wrong',
          expectedState: 's1',
        }),
      ).rejects.toThrow(/state/i)
    })

    it('exchanges a matching redirect URL for tokens', async () => {
      const tokens = await exchangeCode(
        {
          consumerKey: 'k',
          consumerSecret: 's',
          redirectUri: 'http://localhost/cb',
          pastedValue: 'http://localhost/cb?code=abc&state=s1',
          expectedState: 's1',
        },
        {
          extractAuthorizationCode: (input, expectedState) => {
            expect(input).toContain('code=abc')
            expect(expectedState).toBe('s1')
            return 'abc'
          },
          exchangeAuthorizationCode: async () => ({
            access_token: 'access',
            refresh_token: 'refresh',
          }),
        },
      )
      expect(tokens).toEqual({ accessToken: 'access', refreshToken: 'refresh' })
    })

    it('rejects an incomplete token response', async () => {
      await expect(
        exchangeCode(
          {
            consumerKey: 'k',
            consumerSecret: 's',
            redirectUri: 'http://localhost/cb',
            pastedValue: 'http://localhost/cb?code=abc&state=s1',
            expectedState: 's1',
          },
          {
            extractAuthorizationCode: () => 'abc',
            exchangeAuthorizationCode: async () => ({ access_token: 'access' }),
          },
        ),
      ).rejects.toThrow(/did not return the expected tokens/)
    })
  })
})
