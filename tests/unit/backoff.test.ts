/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import { MAX_RETRY_AFTER_MS } from '../../src/settings'
import { parseRetryAfterMs } from '../../src/utils/backoff'

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
