/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import {
  ApiResponseError,
  AuthenticationError,
  createApiError,
  RateLimitError,
  RefreshTokenInvalidError,
} from '../../src/errors'

describe('createApiError', () => {
  it('maps 401/403 to AuthenticationError (non-retryable)', () => {
    expect(createApiError(401, 'x')).toBeInstanceOf(AuthenticationError)
    expect(createApiError(403, 'x')).toBeInstanceOf(AuthenticationError)
    expect(createApiError(401, 'x').isRetryable).toBe(false)
  })

  it('maps 429 to a retryable RateLimitError', () => {
    const err = createApiError(429, 'slow down')
    expect(err).toBeInstanceOf(RateLimitError)
    expect(err.isRetryable).toBe(true)
  })

  it('maps 5xx to a retryable ApiResponseError', () => {
    const err = createApiError(503, 'unavailable')
    expect(err).toBeInstanceOf(ApiResponseError)
    expect(err.isRetryable).toBe(true)
  })

  it('maps 4xx (non-auth) to a non-retryable ApiResponseError', () => {
    const err = createApiError(404, 'missing')
    expect(err).toBeInstanceOf(ApiResponseError)
    expect(err.isRetryable).toBe(false)
  })
})

describe('error metadata', () => {
  it('RefreshTokenInvalidError is an AuthenticationError with a stable code', () => {
    const err = new RefreshTokenInvalidError()
    expect(err).toBeInstanceOf(AuthenticationError)
    expect(err.code).toBe('REFRESH_TOKEN_INVALID')
    expect(err.isRetryable).toBe(false)
  })

  it('serializes to JSON with code and timestamp', () => {
    const json = new RateLimitError('too many').toJSON()
    expect(json.code).toBe('RATE_LIMIT_ERROR')
    expect(json.httpStatus).toBe(429)
    expect(typeof json.timestamp).toBe('string')
  })
})
