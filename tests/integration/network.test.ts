/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * Integration tests that exercise the real native-https transport and token
 * requester via nock-intercepted endpoints.
 */

import nock from 'nock'

import { TokenManager } from '../../src/api/auth'
import { ResideoApiClient } from '../../src/api/client'
import { ConfigurationError, NetworkError, RefreshTokenInvalidError, TimeoutError } from '../../src/errors'
import { API_BASE_URL, MAX_RESPONSE_BODY_BYTES } from '../../src/settings'
import type { TokenManager as TokenManagerType } from '../../src/api/auth'

const BASE = API_BASE_URL
const OVERSIZED_BODY = 'x'.repeat(MAX_RESPONSE_BODY_BYTES + 1)

function stubTokenManager() {
  return {
    getAccessToken: jest.fn().mockResolvedValue('access-token'),
    forceRefresh: jest.fn().mockResolvedValue('access-token'),
    getRefreshToken: jest.fn().mockReturnValue('refresh'),
  } as unknown as TokenManagerType
}

afterEach(() => {
  nock.cleanAll()
})

afterAll(() => {
  nock.restore()
})

describe('TokenManager default requester (native https)', () => {
  it('refreshes the access token over the wire', async () => {
    nock(BASE)
      .post('/oauth2/token')
      .reply(200, { access_token: 'wire-access', refresh_token: 'wire-refresh', expires_in: '1799' })

    const manager = new TokenManager({ consumerKey: 'key', consumerSecret: 'secret', refreshToken: 'r0' })
    await expect(manager.getAccessToken()).resolves.toBe('wire-access')
  })

  it('maps a 400 invalid_grant to RefreshTokenInvalidError', async () => {
    nock(BASE).post('/oauth2/token').reply(400, '{"error":"invalid_grant"}')

    const manager = new TokenManager({ consumerKey: 'key', consumerSecret: 'secret', refreshToken: 'bad' })
    await expect(manager.getAccessToken()).rejects.toBeInstanceOf(RefreshTokenInvalidError)
  })

  it('maps a 401 to a ConfigurationError (rejected API credentials)', async () => {
    nock(BASE).post('/oauth2/token').reply(401, '{"error":"invalid_client"}')

    const manager = new TokenManager({
      consumerKey: 'key',
      consumerSecret: 'wrong',
      refreshToken: 'r0',
      maxRefreshAttempts: 1,
    })
    await expect(manager.getAccessToken()).rejects.toBeInstanceOf(ConfigurationError)
  })

  it('maps a non-grant 400 to RefreshTokenInvalidError', async () => {
    nock(BASE).post('/oauth2/token').reply(400, '{"error":"invalid_request"}')

    const manager = new TokenManager({
      consumerKey: 'key',
      consumerSecret: 'secret',
      refreshToken: 'r0',
      maxRefreshAttempts: 1,
    })
    await expect(manager.getAccessToken()).rejects.toBeInstanceOf(RefreshTokenInvalidError)
  })

  it('does not embed the raw response body in the refresh error message', async () => {
    nock(BASE).post('/oauth2/token').reply(400, '{"error":"invalid_grant","secret_leak":"do-not-log"}')

    const manager = new TokenManager({ consumerKey: 'key', consumerSecret: 'secret', refreshToken: 'bad' })
    let caught: unknown
    try {
      await manager.getAccessToken()
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(RefreshTokenInvalidError)
    expect((caught as Error).message).not.toContain('do-not-log')
  })

  it('maps a 500 to a NetworkError', async () => {
    nock(BASE).post('/oauth2/token').reply(500, 'boom')

    const manager = new TokenManager({
      consumerKey: 'key',
      consumerSecret: 'secret',
      refreshToken: 'r0',
      maxRefreshAttempts: 1,
    })
    await expect(manager.getAccessToken()).rejects.toBeInstanceOf(NetworkError)
  })

  it('maps a socket-level failure to a NetworkError', async () => {
    nock(BASE).post('/oauth2/token').replyWithError({ code: 'ECONNRESET', message: 'reset' })

    const manager = new TokenManager({
      consumerKey: 'key',
      consumerSecret: 'secret',
      refreshToken: 'r0',
      maxRefreshAttempts: 1,
    })
    await expect(manager.getAccessToken()).rejects.toBeInstanceOf(NetworkError)
  })

  it('rejects a token response body that exceeds the size cap', async () => {
    nock(BASE).post('/oauth2/token').reply(200, OVERSIZED_BODY)

    const manager = new TokenManager({
      consumerKey: 'key',
      consumerSecret: 'secret',
      refreshToken: 'r0',
      maxRefreshAttempts: 1,
    })
    await expect(manager.getAccessToken()).rejects.toBeInstanceOf(NetworkError)
  })
})

describe('ResideoApiClient default transport (native https)', () => {
  it('fetches locations with apikey and bearer token', async () => {
    nock(BASE, { reqheaders: { authorization: 'Bearer access-token' } })
      .get('/v2/locations')
      .query({ apikey: 'my-key' })
      .reply(200, [{ locationID: 1, devices: [] }])

    const client = new ResideoApiClient({ tokenManager: stubTokenManager(), apikey: 'my-key' })
    await expect(client.getLocations()).resolves.toEqual([{ locationID: 1, devices: [] }])
  })

  it('fetches a single water leak detector', async () => {
    nock(BASE)
      .get('/v2/devices/waterLeakDetectors/abc-123')
      .query({ apikey: 'my-key', locationId: '5555' })
      .reply(200, { deviceID: 'abc-123', deviceClass: 'LeakDetector', waterPresent: true })

    const client = new ResideoApiClient({ tokenManager: stubTokenManager(), apikey: 'my-key' })
    const device = await client.getWaterLeakDetector('abc-123', 5555)
    expect(device.waterPresent).toBe(true)
  })

  it('raises TimeoutError when the socket stalls past the timeout', async () => {
    nock(BASE)
      .get('/v2/locations')
      .query({ apikey: 'my-key' })
      .delayConnection(300)
      .reply(200, [])

    const client = new ResideoApiClient({
      tokenManager: stubTokenManager(),
      apikey: 'my-key',
      timeoutMs: 50,
      maxRetryAttempts: 1,
    })
    await expect(client.getLocations()).rejects.toBeInstanceOf(TimeoutError)
  })

  it('raises NetworkError on a socket-level failure', async () => {
    nock(BASE)
      .get('/v2/locations')
      .query({ apikey: 'my-key' })
      .replyWithError({ code: 'ECONNRESET', message: 'reset' })

    const client = new ResideoApiClient({
      tokenManager: stubTokenManager(),
      apikey: 'my-key',
      maxRetryAttempts: 1,
    })
    await expect(client.getLocations()).rejects.toBeInstanceOf(NetworkError)
  })

  it('rejects a response body that exceeds the size cap', async () => {
    nock(BASE)
      .get('/v2/locations')
      .query({ apikey: 'my-key' })
      .reply(200, OVERSIZED_BODY)

    const client = new ResideoApiClient({
      tokenManager: stubTokenManager(),
      apikey: 'my-key',
      maxRetryAttempts: 1,
    })
    await expect(client.getLocations()).rejects.toBeInstanceOf(NetworkError)
  })

  it('honors a Retry-After header on 429 and then succeeds', async () => {
    nock(BASE)
      .get('/v2/locations')
      .query({ apikey: 'my-key' })
      .reply(429, 'slow down', { 'Retry-After': '0' })
    nock(BASE)
      .get('/v2/locations')
      .query({ apikey: 'my-key' })
      .reply(200, [{ locationID: 7, devices: [] }])

    const client = new ResideoApiClient({ tokenManager: stubTokenManager(), apikey: 'my-key' })
    await expect(client.getLocations()).resolves.toEqual([{ locationID: 7, devices: [] }])
  })
})
