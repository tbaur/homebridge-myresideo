/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Structured error hierarchy for predictable error handling.
 */

/**
 * Base class for all plugin errors. Carries a stable machine-readable `code`
 * and a `isRetryable` hint so callers (HTTP client, platform poller) can make
 * retry decisions without string-matching messages.
 */
export abstract class ResideoError extends Error {
  abstract readonly code: string
  abstract readonly isRetryable: boolean
  readonly httpStatus?: number
  readonly timestamp: Date

  constructor(message: string, options?: { cause?: Error }) {
    super(message, options)
    this.name = this.constructor.name
    this.timestamp = new Date()
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      isRetryable: this.isRetryable,
      httpStatus: this.httpStatus,
      timestamp: this.timestamp.toISOString(),
    }
  }
}

/** Configuration is missing or invalid; not recoverable without user action. */
export class ConfigurationError extends ResideoError {
  readonly code = 'CONFIG_ERROR'
  readonly isRetryable = false
}

/** Input/argument validation failure. */
export class ValidationError extends ResideoError {
  readonly code = 'VALIDATION_ERROR'
  readonly isRetryable = false
}

/**
 * Authentication/authorization failure (401/403). Never retried by the HTTP
 * client; the platform's token manager handles refresh-and-retry instead.
 */
export class AuthenticationError extends ResideoError {
  readonly code: string = 'AUTH_ERROR'
  readonly isRetryable = false
  readonly httpStatus = 401

  constructor(message = 'Authentication failed', options?: { cause?: Error }) {
    super(message, options)
  }
}

/**
 * The OAuth refresh token is expired or invalid (the API returns
 * `400 invalid_grant`). The user must re-link their account.
 */
export class RefreshTokenInvalidError extends AuthenticationError {
  override readonly code: string = 'REFRESH_TOKEN_INVALID'

  constructor(message = 'Refresh token is expired or invalid; re-link required', options?: { cause?: Error }) {
    super(message, options)
  }
}

/** Network-level failure (DNS, connection reset, etc.). Safe to retry. */
export class NetworkError extends ResideoError {
  readonly code = 'NETWORK_ERROR'
  readonly isRetryable = true
}

/** Request exceeded the configured timeout. Safe to retry. */
export class TimeoutError extends ResideoError {
  readonly code = 'TIMEOUT_ERROR'
  readonly isRetryable = true
}

/** Rate limited by the API (429). Retryable with backoff. */
export class RateLimitError extends ResideoError {
  readonly code = 'RATE_LIMIT_ERROR'
  readonly isRetryable = true
  override readonly httpStatus = 429
}

/** Non-2xx API response that isn't auth/rate-limit. Retryable only for 5xx. */
export class ApiResponseError extends ResideoError {
  readonly code = 'API_RESPONSE_ERROR'
  readonly isRetryable: boolean
  override readonly httpStatus: number

  constructor(status: number, message: string, options?: { cause?: Error }) {
    super(message, options)
    this.httpStatus = status
    this.isRetryable = status >= 500
  }
}

/** Response body could not be parsed as expected (e.g. invalid JSON). */
export class ApiParseError extends ResideoError {
  readonly code = 'API_PARSE_ERROR'
  readonly isRetryable = false
}

/**
 * Map an HTTP status code to the appropriate error type.
 */
export function createApiError(status: number, message: string, cause?: Error): ResideoError {
  if (status === 401 || status === 403) {
    return new AuthenticationError(message, cause ? { cause } : undefined)
  }
  if (status === 429) {
    return new RateLimitError(message, cause ? { cause } : undefined)
  }
  return new ApiResponseError(status, message, cause ? { cause } : undefined)
}
