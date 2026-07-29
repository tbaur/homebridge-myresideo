/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import { ResideoApiClient } from '../../src/api/client'
import type { TokenManager } from '../../src/api/auth'
import type { ApiClientOptions, RawResponse } from '../../src/api/client'
import { CircuitState } from '../../src/api/circuit-breaker'
import {
  ApiParseError,
  ApiResponseError,
  AuthenticationError,
  CircuitBreakerError,
  ForbiddenError,
  NetworkError,
  RateLimitError,
  TimeoutError,
} from '../../src/errors'
import * as backoff from '../../src/utils/backoff'

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
  extras: Partial<ApiClientOptions> = {},
) {
  const client = new ResideoApiClient({
    tokenManager,
    apikey: 'my-api-key',
    maxRetryAttempts: 3,
    transport,
    ...extras,
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

  it('still retries after a 401 that arrives on the final attempt budget', async () => {
    const transport = jest.fn()
      .mockResolvedValueOnce({ status: 401, body: 'unauthorized' })
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ ok: true }) })
    const { client, tokenManager } = makeClient(transport, stubTokenManager(), {
      maxRetryAttempts: 1,
      circuitBreaker: { failureThreshold: 100 },
    })

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

  // A 200 body that parses but is not a usable detector record must never be
  // returned: the platform caches it on the accessory, and a record without a
  // deviceID is later pruned as corrupt, unregistering it from HomeKit.
  describe('detector payload validation', () => {
    const unusableBodies: Array<[string, string]> = [
      ['null', 'null'],
      ['an empty object', '{}'],
      ['an array', '[]'],
      ['an object with no deviceID', JSON.stringify({ waterPresent: false, batteryRemaining: 90 })],
      ['an object with an empty deviceID', JSON.stringify({ deviceID: '', waterPresent: false })],
      ['a gateway error object', JSON.stringify({ message: 'Forbidden', code: 401 })],
    ]

    it.each(unusableBodies)('rejects a 200 body that is %s', async (_label, body) => {
      const transport = jest.fn().mockResolvedValue({ status: 200, body })
      const { client } = makeClient(transport, stubTokenManager(), { maxRetryAttempts: 1 })

      await expect(client.getWaterLeakDetector('abc-123', 5555)).rejects.toThrow(ApiParseError)
    })

    it('accepts a minimal payload that carries a deviceID', async () => {
      const transport = jest.fn().mockResolvedValue({
        status: 200,
        body: JSON.stringify({ deviceID: 'abc-123', waterPresent: true }),
      })
      const { client } = makeClient(transport)

      await expect(client.getWaterLeakDetector('abc-123', 5555))
        .resolves.toEqual({ deviceID: 'abc-123', waterPresent: true })
    })

    it('counts an unusable payload as a breaker failure, not a success', async () => {
      const transport = jest.fn().mockResolvedValue({ status: 200, body: '{}' })
      const { client } = makeClient(transport, stubTokenManager(), {
        maxRetryAttempts: 1,
        circuitBreaker: { failureThreshold: 2 },
      })

      await expect(client.getWaterLeakDetector('a', 1)).rejects.toThrow(ApiParseError)
      await expect(client.getWaterLeakDetector('a', 1)).rejects.toThrow(ApiParseError)

      expect(client.getStatus().circuitBreaker.state).toBe(CircuitState.OPEN)
    })
  })

  describe('diagnostics hooks', () => {
    it('reports one successful metric per networked attempt', async () => {
      const metrics = jest.fn()
      const transport = jest.fn().mockResolvedValue({ status: 200, body: JSON.stringify({ ok: true }) })
      const client = new ResideoApiClient({
        tokenManager: stubTokenManager(),
        apikey: 'my-api-key',
        transport,
        metrics,
      })

      await client.get('https://api.honeywellhome.com/v2/locations', {})

      expect(metrics).toHaveBeenCalledTimes(1)
      expect(metrics).toHaveBeenCalledWith({ durationMs: expect.any(Number), ok: true })
    })

    it('reports a failed metric for a non-2xx response and for each retry', async () => {
      const metrics = jest.fn()
      const onRetry = jest.fn()
      const transport = jest.fn()
        .mockResolvedValueOnce({ status: 500, body: 'server error' })
        .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ ok: true }) })
      const client = new ResideoApiClient({
        tokenManager: stubTokenManager(),
        apikey: 'my-api-key',
        transport,
        metrics,
        onRetry,
      })

      await client.get('https://api.honeywellhome.com/v2/locations', {})

      expect(metrics).toHaveBeenCalledTimes(2)
      expect(metrics).toHaveBeenNthCalledWith(1, { durationMs: expect.any(Number), ok: false })
      expect(metrics).toHaveBeenNthCalledWith(2, { durationMs: expect.any(Number), ok: true })
      expect(onRetry).toHaveBeenCalledTimes(1)
    })

    it('reports a failed metric when a 200 response body cannot be parsed', async () => {
      const metrics = jest.fn()
      const transport = jest.fn().mockResolvedValue({ status: 200, body: 'not json' })
      const client = new ResideoApiClient({
        tokenManager: stubTokenManager(),
        apikey: 'my-api-key',
        transport,
        metrics,
      })

      await expect(client.get('https://api.honeywellhome.com/v2/locations', {}))
        .rejects.toBeInstanceOf(ApiParseError)
      expect(metrics).toHaveBeenCalledTimes(1)
      expect(metrics).toHaveBeenCalledWith({ durationMs: expect.any(Number), ok: false })
    })

    it('reports a failed metric when the transport throws', async () => {
      const metrics = jest.fn()
      const transport = jest.fn()
        .mockRejectedValueOnce(new NetworkError('connection reset'))
        .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ ok: true }) })
      const client = new ResideoApiClient({
        tokenManager: stubTokenManager(),
        apikey: 'my-api-key',
        transport,
        metrics,
      })

      await client.get('https://api.honeywellhome.com/v2/locations', {})

      expect(metrics).toHaveBeenNthCalledWith(1, { durationMs: expect.any(Number), ok: false })
      expect(metrics).toHaveBeenCalledTimes(2)
    })

    it('counts the 401 refresh-and-retry as a retry', async () => {
      const onRetry = jest.fn()
      const transport = jest.fn()
        .mockResolvedValueOnce({ status: 401, body: 'unauthorized' })
        .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ ok: true }) })
      const client = new ResideoApiClient({
        tokenManager: stubTokenManager(),
        apikey: 'my-api-key',
        transport,
        onRetry,
      })

      await client.get('https://api.honeywellhome.com/v2/locations', {})

      expect(onRetry).toHaveBeenCalledTimes(1)
    })
  })

  describe('error messages', () => {
    it('surfaces a short status-only message without the URL or query string', async () => {
      const transport = jest.fn().mockResolvedValue({ status: 500, body: 'server error' })
      const { client } = makeClient(transport, stubTokenManager(), {
        maxRetryAttempts: 1,
        circuitBreaker: { failureThreshold: 100 },
      })

      await expect(client.get('https://api.honeywellhome.com/v2/locations', {}))
        .rejects.toMatchObject({
          message: 'API request failed: 500',
        })
      expect(transport).toHaveBeenCalledTimes(1)
    })

    it('mentions only the pathname when JSON parse fails', async () => {
      const transport = jest.fn().mockResolvedValue({ status: 200, body: 'not json' })
      const { client } = makeClient(transport, stubTokenManager(), {
        circuitBreaker: { failureThreshold: 100 },
      })

      await expect(client.get('https://api.honeywellhome.com/v2/locations', {}))
        .rejects.toMatchObject({
          message: 'Failed to parse response from /v2/locations',
        })
    })
  })

  describe('circuit breaker', () => {
    it('opens after the failure threshold of logical 5xx failures', async () => {
      const warn = jest.fn()
      const onCircuitOpen = jest.fn()
      const transport = jest.fn().mockResolvedValue({ status: 500, body: 'server error' })
      const { client } = makeClient(transport, stubTokenManager(), {
        maxRetryAttempts: 1,
        circuitBreaker: { failureThreshold: 2, resetTimeout: 30_000 },
        logger: { warn, info: jest.fn(), debug: jest.fn(), error: jest.fn() },
        onCircuitOpen,
      })

      await expect(client.get('https://api.honeywellhome.com/v2/locations', {}))
        .rejects.toBeInstanceOf(ApiResponseError)
      await expect(client.get('https://api.honeywellhome.com/v2/locations', {}))
        .rejects.toBeInstanceOf(ApiResponseError)

      expect(client.getStatus().circuitBreaker.state).toBe(CircuitState.OPEN)
      expect(warn).toHaveBeenCalledWith('Circuit breaker CLOSED -> OPEN')
      expect(onCircuitOpen).toHaveBeenCalledTimes(1)
    })

    it('fails fast without calling the transport while open', async () => {
      const transport = jest.fn().mockResolvedValue({ status: 500, body: 'server error' })
      const { client } = makeClient(transport, stubTokenManager(), {
        maxRetryAttempts: 1,
        circuitBreaker: { failureThreshold: 1, resetTimeout: 30_000 },
      })

      await expect(client.get('https://api.honeywellhome.com/v2/locations', {}))
        .rejects.toBeInstanceOf(ApiResponseError)
      transport.mockClear()

      await expect(client.get('https://api.honeywellhome.com/v2/locations', {}))
        .rejects.toBeInstanceOf(CircuitBreakerError)
      expect(transport).not.toHaveBeenCalled()
    })

    it('does not trip on 4xx client errors', async () => {
      const transport = jest.fn().mockResolvedValue({ status: 404, body: 'missing' })
      const { client } = makeClient(transport, stubTokenManager(), {
        circuitBreaker: { failureThreshold: 1 },
      })

      await expect(client.get('https://api.honeywellhome.com/v2/locations', {}))
        .rejects.toBeInstanceOf(ApiResponseError)
      expect(client.getStatus().circuitBreaker.state).toBe(CircuitState.CLOSED)
    })

    it('does not trip on authentication failures', async () => {
      const transport = jest.fn().mockResolvedValue({ status: 401, body: 'unauthorized' })
      const { client } = makeClient(transport, stubTokenManager(), {
        circuitBreaker: { failureThreshold: 1 },
      })

      await expect(client.get('https://api.honeywellhome.com/v2/locations', {}))
        .rejects.toBeInstanceOf(AuthenticationError)
      expect(client.getStatus().circuitBreaker.state).toBe(CircuitState.CLOSED)
    })

    it('closes again after successful half-open probes', async () => {
      jest.useFakeTimers()
      try {
        const info = jest.fn()
        const transport = jest.fn()
          .mockResolvedValueOnce({ status: 500, body: 'server error' })
          .mockResolvedValue({ status: 200, body: JSON.stringify({ ok: true }) })
        const { client } = makeClient(transport, stubTokenManager(), {
          maxRetryAttempts: 1,
          circuitBreaker: { failureThreshold: 1, resetTimeout: 1000, halfOpenMax: 1 },
          logger: { warn: jest.fn(), info, debug: jest.fn(), error: jest.fn() },
        })

        await expect(client.get('https://api.honeywellhome.com/v2/locations', {}))
          .rejects.toBeInstanceOf(ApiResponseError)
        expect(client.getStatus().circuitBreaker.state).toBe(CircuitState.OPEN)

        await jest.advanceTimersByTimeAsync(1100)
        await expect(client.get('https://api.honeywellhome.com/v2/locations', {}))
          .resolves.toEqual({ ok: true })

        expect(client.getStatus().circuitBreaker.state).toBe(CircuitState.CLOSED)
        expect(info).toHaveBeenCalledWith('Circuit breaker OPEN -> HALF_OPEN')
        expect(info).toHaveBeenCalledWith('Circuit breaker HALF_OPEN -> CLOSED')
      } finally {
        jest.useRealTimers()
      }
    })

    it('does not record a metric for a pre-flight open-breaker rejection', async () => {
      const metrics = jest.fn()
      const transport = jest.fn().mockResolvedValue({ status: 500, body: 'server error' })
      const { client } = makeClient(transport, stubTokenManager(), {
        maxRetryAttempts: 1,
        circuitBreaker: { failureThreshold: 1 },
        metrics,
      })

      await expect(client.get('https://api.honeywellhome.com/v2/locations', {}))
        .rejects.toBeInstanceOf(ApiResponseError)
      metrics.mockClear()

      await expect(client.get('https://api.honeywellhome.com/v2/locations', {}))
        .rejects.toBeInstanceOf(CircuitBreakerError)
      expect(metrics).not.toHaveBeenCalled()
    })

    it('records one breaker failure per logical request after retries are exhausted', async () => {
      const delaySpy = jest.spyOn(backoff, 'delay').mockResolvedValue(undefined)
      const backoffSpy = jest.spyOn(backoff, 'backoffMs').mockReturnValue(0)
      try {
        const transport = jest.fn().mockResolvedValue({ status: 500, body: 'server error' })
        const { client } = makeClient(transport, stubTokenManager(), {
          maxRetryAttempts: 3,
          circuitBreaker: { failureThreshold: 2, resetTimeout: 30_000 },
        })

        // First logical request: three transport attempts, one breaker failure.
        await expect(client.get('https://api.honeywellhome.com/v2/locations', {}))
          .rejects.toBeInstanceOf(ApiResponseError)
        expect(transport).toHaveBeenCalledTimes(3)
        expect(client.getStatus().circuitBreaker.state).toBe(CircuitState.CLOSED)
        expect(client.getStatus().circuitBreaker.failures).toBe(1)

        // Second logical request trips the threshold (still three attempts, not six failures).
        await expect(client.get('https://api.honeywellhome.com/v2/locations', {}))
          .rejects.toBeInstanceOf(ApiResponseError)
        expect(transport).toHaveBeenCalledTimes(6)
        expect(client.getStatus().circuitBreaker.state).toBe(CircuitState.OPEN)
      } finally {
        delaySpy.mockRestore()
        backoffSpy.mockRestore()
      }
    })

    it('does not trip on 429 rate-limit errors', async () => {
      const transport = jest.fn().mockResolvedValue({
        status: 429,
        body: 'slow down',
        headers: { 'retry-after': '0' },
      })
      const { client } = makeClient(transport, stubTokenManager(), {
        maxRetryAttempts: 1,
        circuitBreaker: { failureThreshold: 1 },
      })

      await expect(client.get('https://api.honeywellhome.com/v2/locations', {}))
        .rejects.toBeInstanceOf(RateLimitError)
      expect(client.getStatus().circuitBreaker.state).toBe(CircuitState.CLOSED)
    })

    it('counts a 200 non-array locations payload as a breaker failure', async () => {
      const transport = jest.fn().mockResolvedValue({
        status: 200,
        body: JSON.stringify({ error: 'nope' }),
      })
      const { client } = makeClient(transport, stubTokenManager(), {
        circuitBreaker: { failureThreshold: 1 },
      })

      await expect(client.getLocations()).rejects.toBeInstanceOf(ApiParseError)
      expect(client.getStatus().circuitBreaker.state).toBe(CircuitState.OPEN)
    })

    it('releases a half-open probe that fails with 403 (does not wedge HALF_OPEN)', async () => {
      jest.useFakeTimers()
      try {
        const transport = jest.fn()
          .mockResolvedValueOnce({ status: 500, body: 'server error' })
          .mockResolvedValue({ status: 403, body: 'forbidden' })
        const { client } = makeClient(transport, stubTokenManager(), {
          maxRetryAttempts: 1,
          circuitBreaker: { failureThreshold: 1, resetTimeout: 1000, halfOpenMax: 1 },
        })

        await expect(client.get('https://api.honeywellhome.com/v2/locations', {}))
          .rejects.toBeInstanceOf(ApiResponseError)
        expect(client.getStatus().circuitBreaker.state).toBe(CircuitState.OPEN)

        await jest.advanceTimersByTimeAsync(1100)
        await expect(client.get('https://api.honeywellhome.com/v2/locations', {}))
          .rejects.toBeInstanceOf(ForbiddenError)

        // Must re-open — not stay HALF_OPEN with a consumed probe slot.
        expect(client.getStatus().circuitBreaker.state).toBe(CircuitState.OPEN)

        // After another cooldown, a probe is allowed again (not wedged forever).
        await jest.advanceTimersByTimeAsync(1100)
        await expect(client.get('https://api.honeywellhome.com/v2/locations', {}))
          .rejects.toBeInstanceOf(ForbiddenError)
        expect(transport).toHaveBeenCalledTimes(3)
      } finally {
        jest.useRealTimers()
      }
    })
  })
})
