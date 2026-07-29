/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import { MAX_RETRY_AFTER_MS } from '../../src/settings'
import { backoffMs, delay, parseRetryAfterMs } from '../../src/utils/backoff'

describe('backoffMs', () => {
  it('grows exponentially from the base', () => {
    // Pin jitter to the midpoint so the exponential term is exact.
    jest.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(backoffMs(1, 1000, 8000)).toBe(1000)
    expect(backoffMs(2, 1000, 8000)).toBe(2000)
    expect(backoffMs(3, 1000, 8000)).toBe(4000)
  })

  it('never exceeds the cap, jitter included', () => {
    jest.spyOn(Math, 'random').mockReturnValue(1)
    // +20% jitter on a capped 8000ms exponential.
    expect(backoffMs(20, 1000, 8000)).toBe(9600)
  })

  it('stays non-negative when jitter is fully negative', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0)
    expect(backoffMs(1, 1000, 8000)).toBeGreaterThanOrEqual(0)
  })

  it('applies jitter within +/-20% of the exponential term', () => {
    const samples = Array.from({ length: 200 }, () => backoffMs(2, 1000, 8000))
    for (const sample of samples) {
      expect(sample).toBeGreaterThanOrEqual(1600)
      expect(sample).toBeLessThanOrEqual(2400)
    }
    // Jitter must actually vary, otherwise retries synchronize across instances.
    expect(new Set(samples).size).toBeGreaterThan(1)
  })
})

describe('delay', () => {
  it('resolves after the requested time', async () => {
    jest.useFakeTimers()
    try {
      let resolved = false
      const pending = delay(5000).then(() => {
        resolved = true
      })

      jest.advanceTimersByTime(4999)
      await Promise.resolve()
      expect(resolved).toBe(false)

      jest.advanceTimersByTime(1)
      await pending
      expect(resolved).toBe(true)
    } finally {
      jest.useRealTimers()
    }
  })

  it('unrefs its timer so a pending retry cannot hold the process open', () => {
    // A Retry-After can park a retry for up to MAX_RETRY_AFTER_MS, far past
    // Homebridge's shutdown window.
    const unref = jest.fn()
    const setTimeoutSpy = jest
      .spyOn(global, 'setTimeout')
      .mockReturnValue({ unref } as unknown as NodeJS.Timeout)

    void delay(MAX_RETRY_AFTER_MS)

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), MAX_RETRY_AFTER_MS)
    expect(unref).toHaveBeenCalledTimes(1)
  })
})

describe('parseRetryAfterMs', () => {
  it('parses delta-seconds', () => {
    expect(parseRetryAfterMs('2')).toBe(2000)
  })

  it('returns undefined for missing or empty headers', () => {
    expect(parseRetryAfterMs(undefined)).toBeUndefined()
    expect(parseRetryAfterMs('')).toBeUndefined()
    expect(parseRetryAfterMs('   ')).toBeUndefined()
  })

  it('clamps to MAX_RETRY_AFTER_MS', () => {
    expect(parseRetryAfterMs(String(MAX_RETRY_AFTER_MS / 1000 + 60))).toBe(MAX_RETRY_AFTER_MS)
  })

  it('accepts the first value when the header is an array', () => {
    expect(parseRetryAfterMs(['1', '9'])).toBe(1000)
  })

  it('parses an HTTP-date Retry-After value', () => {
    const when = new Date(Date.now() + 1500).toUTCString()
    const ms = parseRetryAfterMs(when)
    expect(ms).toBeGreaterThan(0)
    expect(ms).toBeLessThanOrEqual(MAX_RETRY_AFTER_MS)
  })
})
