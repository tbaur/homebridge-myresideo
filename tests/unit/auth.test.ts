/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import { TokenManager, buildAuthorizeUrl, exchangeAuthorizationCode } from '../../src/api/auth'
import { NetworkError, RefreshTokenInvalidError, ValidationError } from '../../src/errors'
import { AUTHORIZE_URL } from '../../src/settings'
import type { TokenResponse } from '../../src/types'

function makeTokenResponse(overrides: Partial<TokenResponse> = {}): TokenResponse {
  return {
    access_token: 'access-1',
    refresh_token: 'refresh-1',
    expires_in: '1799',
    ...overrides,
  }
}

describe('TokenManager', () => {
  it('refreshes to obtain an access token when none is cached', async () => {
    const requestToken = jest.fn().mockResolvedValue(makeTokenResponse())
    const manager = new TokenManager({
      consumerKey: 'key',
      consumerSecret: 'secret',
      refreshToken: 'refresh-0',
      requestToken,
    })

    await expect(manager.getAccessToken()).resolves.toBe('access-1')
    expect(requestToken).toHaveBeenCalledTimes(1)
  })

  it('caches the access token until it nears expiry', async () => {
    let clock = 1_000_000
    const requestToken = jest.fn().mockResolvedValue(makeTokenResponse({ expires_in: '1799' }))
    const manager = new TokenManager({
      consumerKey: 'key',
      consumerSecret: 'secret',
      refreshToken: 'refresh-0',
      now: () => clock,
      requestToken,
    })

    await manager.getAccessToken()
    clock += 60_000 // well within the token lifetime
    await manager.getAccessToken()
    expect(requestToken).toHaveBeenCalledTimes(1)

    clock += 1799 * 1000 // push past expiry (minus buffer)
    await manager.getAccessToken()
    expect(requestToken).toHaveBeenCalledTimes(2)
  })

  it('collapses concurrent refreshes into a single request', async () => {
    let resolveToken: (t: TokenResponse) => void = () => {}
    const requestToken = jest.fn().mockImplementation(
      () => new Promise<TokenResponse>((resolve) => { resolveToken = resolve }),
    )
    const manager = new TokenManager({
      consumerKey: 'key',
      consumerSecret: 'secret',
      refreshToken: 'refresh-0',
      requestToken,
    })

    const a = manager.getAccessToken()
    const b = manager.getAccessToken()
    resolveToken(makeTokenResponse())

    await expect(Promise.all([a, b])).resolves.toEqual(['access-1', 'access-1'])
    expect(requestToken).toHaveBeenCalledTimes(1)
  })

  it('persists a rotated refresh token', async () => {
    const onRefreshToken = jest.fn()
    const requestToken = jest.fn().mockResolvedValue(makeTokenResponse({ refresh_token: 'refresh-rotated' }))
    const manager = new TokenManager({
      consumerKey: 'key',
      consumerSecret: 'secret',
      refreshToken: 'refresh-0',
      onRefreshToken,
      requestToken,
    })

    await manager.getAccessToken()
    expect(onRefreshToken).toHaveBeenCalledWith('refresh-rotated')
    expect(manager.getRefreshToken()).toBe('refresh-rotated')
  })

  it('forceRefresh bypasses the cache', async () => {
    const requestToken = jest.fn().mockResolvedValue(makeTokenResponse())
    const manager = new TokenManager({
      consumerKey: 'key',
      consumerSecret: 'secret',
      refreshToken: 'refresh-0',
      requestToken,
    })

    await manager.getAccessToken()
    await manager.forceRefresh()
    expect(requestToken).toHaveBeenCalledTimes(2)
  })

  it('propagates an invalid-grant error', async () => {
    const requestToken = jest.fn().mockRejectedValue(new RefreshTokenInvalidError())
    const manager = new TokenManager({
      consumerKey: 'key',
      consumerSecret: 'secret',
      refreshToken: 'bad',
      requestToken,
    })

    await expect(manager.getAccessToken()).rejects.toBeInstanceOf(RefreshTokenInvalidError)
  })

  it('uses a config-supplied access token optimistically without an immediate refresh', async () => {
    const requestToken = jest.fn().mockResolvedValue(makeTokenResponse())
    const manager = new TokenManager({
      consumerKey: 'key',
      consumerSecret: 'secret',
      refreshToken: 'refresh-0',
      accessToken: 'config-access',
      requestToken,
    })

    await expect(manager.getAccessToken()).resolves.toBe('config-access')
    expect(requestToken).not.toHaveBeenCalled()

    // After the optimistic use, the next call refreshes to establish a real expiry.
    await expect(manager.getAccessToken()).resolves.toBe('access-1')
    expect(requestToken).toHaveBeenCalledTimes(1)
  })

  it('retries a transient network failure during refresh, then succeeds', async () => {
    const requestToken = jest.fn()
      .mockRejectedValueOnce(new NetworkError('connection reset'))
      .mockResolvedValueOnce(makeTokenResponse())
    const manager = new TokenManager({
      consumerKey: 'key',
      consumerSecret: 'secret',
      refreshToken: 'refresh-0',
      requestToken,
    })

    await expect(manager.getAccessToken()).resolves.toBe('access-1')
    expect(requestToken).toHaveBeenCalledTimes(2)
  })

  it('gives up after maxRefreshAttempts transient failures', async () => {
    const requestToken = jest.fn().mockRejectedValue(new NetworkError('down'))
    const manager = new TokenManager({
      consumerKey: 'key',
      consumerSecret: 'secret',
      refreshToken: 'refresh-0',
      maxRefreshAttempts: 2,
      requestToken,
    })

    await expect(manager.getAccessToken()).rejects.toBeInstanceOf(NetworkError)
    expect(requestToken).toHaveBeenCalledTimes(2)
  })
})

describe('buildAuthorizeUrl', () => {
  it('builds the authorize URL with the expected query parameters', () => {
    const url = new URL(buildAuthorizeUrl('my-key', 'http://localhost:8581/oauth/callback'))
    expect(`${url.origin}${url.pathname}`).toBe(AUTHORIZE_URL)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('my-key')
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:8581/oauth/callback')
  })

  it('url-encodes the redirect URI', () => {
    const url = buildAuthorizeUrl('k', 'http://localhost:8581/oauth/callback?x=1')
    expect(url).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A8581%2Foauth%2Fcallback%3Fx%3D1')
  })

  it('rejects a missing consumer key', () => {
    expect(() => buildAuthorizeUrl('', 'http://localhost/cb')).toThrow(ValidationError)
  })

  it('rejects a missing redirect URI', () => {
    expect(() => buildAuthorizeUrl('k', '')).toThrow(ValidationError)
  })
})

describe('exchangeAuthorizationCode', () => {
  it('posts the authorization_code grant with the right form body and Basic auth', async () => {
    const requestToken = jest.fn().mockResolvedValue(makeTokenResponse())
    const tokens = await exchangeAuthorizationCode({
      consumerKey: 'my-key',
      consumerSecret: 'my-secret',
      code: 'auth-code',
      redirectUri: 'http://localhost:8581/oauth/callback',
      requestToken,
    })

    expect(tokens).toEqual(makeTokenResponse())
    expect(requestToken).toHaveBeenCalledTimes(1)
    const [formBody, basicAuth] = requestToken.mock.calls[0]
    const params = new URLSearchParams(formBody as string)
    expect(params.get('grant_type')).toBe('authorization_code')
    expect(params.get('code')).toBe('auth-code')
    expect(params.get('redirect_uri')).toBe('http://localhost:8581/oauth/callback')
    expect(Buffer.from(basicAuth as string, 'base64').toString('utf8')).toBe('my-key:my-secret')
  })

  it('propagates a typed error from the token endpoint', async () => {
    const requestToken = jest.fn().mockRejectedValue(new RefreshTokenInvalidError())
    await expect(
      exchangeAuthorizationCode({
        consumerKey: 'k',
        consumerSecret: 's',
        code: 'bad',
        redirectUri: 'http://localhost/cb',
        requestToken,
      }),
    ).rejects.toBeInstanceOf(RefreshTokenInvalidError)
  })

  it.each([
    ['', 's', 'code', 'http://localhost/cb'],
    ['k', '', 'code', 'http://localhost/cb'],
    ['k', 's', '', 'http://localhost/cb'],
    ['k', 's', 'code', ''],
  ])('rejects missing inputs (key=%p secret=%p code=%p uri=%p)', async (consumerKey, consumerSecret, code, redirectUri) => {
    const requestToken = jest.fn()
    await expect(
      exchangeAuthorizationCode({ consumerKey, consumerSecret, code, redirectUri, requestToken }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(requestToken).not.toHaveBeenCalled()
  })
})
