/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import { maskToken, sanitizeError, sanitizeString } from '../../src/utils'

describe('sanitizeString', () => {
  it('redacts the apikey query parameter', () => {
    expect(sanitizeString('GET /v2/locations?apikey=SUPERSECRET123&foo=1'))
      .toBe('GET /v2/locations?apikey=***&foo=1')
  })

  it('fully redacts an Authorization: Bearer header (token value does not survive)', () => {
    const out = sanitizeString('Authorization: Bearer abc.def.ghi')
    expect(out).not.toContain('abc.def.ghi')
    expect(out).toContain('authorization=***')
  })

  it('redacts a bare bearer token', () => {
    expect(sanitizeString('Bearer abc.def.ghi failed')).toBe('Bearer *** failed')
  })

  it('redacts access and refresh tokens in JSON', () => {
    const json = '{"access_token":"aaa","refresh_token":"bbb"}'
    const out = sanitizeString(json)
    expect(out).toContain('"access_token":"***"')
    expect(out).toContain('"refresh_token":"***"')
    expect(out).not.toContain('aaa')
    expect(out).not.toContain('bbb')
  })

  it('redacts the consumer/client secret', () => {
    expect(sanitizeString('consumerSecret=topsecretvalue used')).not.toContain('topsecretvalue')
    const json = sanitizeString('{"consumerSecret":"abc123"}')
    expect(json).not.toContain('abc123')
    expect(sanitizeString('client_secret=zzz')).not.toContain('zzz')
  })

  it('fully redacts a Basic auth credential (base64 value does not survive)', () => {
    const out = sanitizeString('Authorization: Basic a2V5OnNlY3JldA==')
    expect(out).not.toContain('a2V5OnNlY3JldA')
  })

  it('redacts a bare Basic credential', () => {
    expect(sanitizeString('Basic a2V5OnNlY3JldA== rejected')).toBe('Basic *** rejected')
  })

  it('leaves non-sensitive strings unchanged', () => {
    expect(sanitizeString('Discovered 2 detectors')).toBe('Discovered 2 detectors')
  })
})

describe('sanitizeError', () => {
  it('sanitizes an Error message', () => {
    expect(sanitizeError(new Error('failed with apikey=LEAKED'))).toBe('failed with apikey=***')
  })

  it('handles string errors', () => {
    expect(sanitizeError('Bearer xyz failed')).toBe('Bearer *** failed')
  })

  it('handles non-error, non-string values', () => {
    expect(sanitizeError({ code: 1 })).toBe('[object Object]')
  })
})

describe('maskToken', () => {
  it('masks the middle of a long token', () => {
    expect(maskToken('abcd1234efgh5678')).toBe('abcd…5678')
  })

  it('fully masks short tokens', () => {
    expect(maskToken('short')).toBe('***')
  })

  it('returns *** for empty or nullish input', () => {
    expect(maskToken('')).toBe('***')
    expect(maskToken(undefined)).toBe('***')
    expect(maskToken(null)).toBe('***')
  })
})
