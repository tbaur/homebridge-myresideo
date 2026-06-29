/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import { ResideoApiClient } from '../../src/api/client'
import type { TokenManager } from '../../src/api/auth'
import type { RawResponse } from '../../src/api/client'
import { ApiParseError, ApiResponseError, AuthenticationError, NetworkError, TimeoutError } from '../../src/errors'

function stubTokenManager() {
  return {
    getAccessToken: jest.fn().mockResolvedValue('access-token'),
    forceRefresh: jest.fn().mockResolvedValue('new-access-token'),
    getRefreshToken: jest.fn().mockReturnValue('refresh'),
  } as unknown as TokenManager
}

function makeClient(
  transport: (url: string, token: string, timeoutMs: number) => Promise<RawResponse>,
  tokenManager = stubTokenManager(),
) {
  const client = new ResideoApiClient({
    tokenManager,
    apikey: 'my-api-key',
    maxRetryAttempts: 3,
    transport,
  })
  return { client, tokenManager }
}

describe('ResideoApiClient', () => {
  it('injects apikey and bearer token and parses JSON', async () => {
    const seen: { url: string, token: string } = { url: '', token: '' }
    const transport = jest.fn(async (url: string, token: string) => {
      seen.url = url
      seen.token = token
      return { status: 200, body: JSON.stringify({ ok: true }) }
    })
    const { client } = makeClient(transport)

    const result = await client.get<{ ok: boolean }>('https://api.honeywellhome.com/v2/locations', {})

    expect(result).toEqual({ ok: true })
    expect(seen.url).toContain('apikey=my-api-key')
    expect(seen.token).toBe('access-token')
  })

  it('retries on a 500 then succeeds', async () => {
    const transport = jest.fn()
      .mockResolvedValueOnce({ status: 500, body: 'server error' })
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ ok: true }) })
    const { client } = makeClient(transport)

    await expect(client.get('https://api.honeywellhome.com/v2/locations', {})).resolves.toEqual({ ok: true })
    expect(transport).toHaveBeenCalledTimes(2)
  })

  it('refreshes the token once and retries on a 401', async () => {
    const transport = jest.fn()
      .mockResolvedValueOnce({ status: 401, body: 'unauthorized' })
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ ok: true }) })
    const { client, tokenManager } = makeClient(transport)

    await expect(client.get('https://api.honeywellhome.com/v2/locations', {})).resolves.toEqual({ ok: true })
    expect(tokenManager.forceRefresh).toHaveBeenCalledTimes(1)
    expect(transport).toHaveBeenCalledTimes(2)
  })

  it('throws AuthenticationError when refresh-and-retry still fails', async () => {
    const transport = jest.fn().mockResolvedValue({ status: 401, body: 'unauthorized' })
    const { client } = makeClient(transport)

    await expect(client.get('https://api.honeywellhome.com/v2/locations', {}))
      .rejects.toBeInstanceOf(AuthenticationError)
  })

  it('does not retry a non-retryable 404', async () => {
    const transport = jest.fn().mockResolvedValue({ status: 404, body: 'not found' })
    const { client } = makeClient(transport)

    await expect(client.get('https://api.honeywellhome.com/v2/locations', {}))
      .rejects.toBeInstanceOf(ApiResponseError)
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('throws ApiParseError on invalid JSON', async () => {
    const transport = jest.fn().mockResolvedValue({ status: 200, body: 'not json' })
    const { client } = makeClient(transport)

    await expect(client.get('https://api.honeywellhome.com/v2/locations', {}))
      .rejects.toBeInstanceOf(ApiParseError)
  })

  it('retries transient network errors then surfaces the last one', async () => {
    const transport = jest.fn().mockRejectedValue(new NetworkError('connection reset'))
    const { client } = makeClient(transport)

    await expect(client.get('https://api.honeywellhome.com/v2/locations', {}))
      .rejects.toBeInstanceOf(NetworkError)
    expect(transport).toHaveBeenCalledTimes(3)
  })

  it('retries on timeout', async () => {
    const transport = jest.fn()
      .mockRejectedValueOnce(new TimeoutError('timed out'))
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ ok: true }) })
    const { client } = makeClient(transport)

    await expect(client.get('https://api.honeywellhome.com/v2/locations', {})).resolves.toEqual({ ok: true })
    expect(transport).toHaveBeenCalledTimes(2)
  })

  it('rejects a non-array locations payload with ApiParseError', async () => {
    const transport = jest.fn().mockResolvedValue({ status: 200, body: JSON.stringify({ error: 'nope' }) })
    const { client } = makeClient(transport)

    await expect(client.getLocations()).rejects.toBeInstanceOf(ApiParseError)
  })

  it('returns a valid locations array', async () => {
    const transport = jest.fn().mockResolvedValue({
      status: 200,
      body: JSON.stringify([{ locationID: 1, devices: [] }]),
    })
    const { client } = makeClient(transport)

    await expect(client.getLocations()).resolves.toEqual([{ locationID: 1, devices: [] }])
  })

  it('builds the water leak detector URL with deviceId and locationId', async () => {
    let capturedUrl = ''
    const transport = jest.fn(async (url: string) => {
      capturedUrl = url
      return { status: 200, body: JSON.stringify({ deviceID: 'abc', waterPresent: false }) }
    })
    const { client } = makeClient(transport)

    await client.getWaterLeakDetector('abc-123', 5555)

    expect(capturedUrl).toContain('/v2/devices/waterLeakDetectors/abc-123')
    expect(capturedUrl).toContain('locationId=5555')
    expect(capturedUrl).toContain('apikey=my-api-key')
  })
})
