"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Structured error hierarchy for predictable error handling.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiParseError = exports.ApiResponseError = exports.RateLimitError = exports.TimeoutError = exports.NetworkError = exports.RefreshTokenInvalidError = exports.AuthenticationError = exports.ValidationError = exports.ConfigurationError = exports.ResideoError = void 0;
exports.createApiError = createApiError;
/**
 * Base class for all plugin errors. Carries a stable machine-readable `code`
 * and a `isRetryable` hint so callers (HTTP client, platform poller) can make
 * retry decisions without string-matching messages.
 */
class ResideoError extends Error {
    httpStatus;
    timestamp;
    constructor(message, options) {
        super(message, options);
        this.name = this.constructor.name;
        this.timestamp = new Date();
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
    toJSON() {
        return {
            name: this.name,
            code: this.code,
            message: this.message,
            isRetryable: this.isRetryable,
            httpStatus: this.httpStatus,
            timestamp: this.timestamp.toISOString(),
        };
    }
}
exports.ResideoError = ResideoError;
/** Configuration is missing or invalid; not recoverable without user action. */
class ConfigurationError extends ResideoError {
    code = 'CONFIG_ERROR';
    isRetryable = false;
}
exports.ConfigurationError = ConfigurationError;
/** Input/argument validation failure. */
class ValidationError extends ResideoError {
    code = 'VALIDATION_ERROR';
    isRetryable = false;
}
exports.ValidationError = ValidationError;
/**
 * Authentication/authorization failure (401/403). Never retried by the HTTP
 * client; the platform's token manager handles refresh-and-retry instead.
 */
class AuthenticationError extends ResideoError {
    code = 'AUTH_ERROR';
    isRetryable = false;
    httpStatus = 401;
    constructor(message = 'Authentication failed', options) {
        super(message, options);
    }
}
exports.AuthenticationError = AuthenticationError;
/**
 * The OAuth refresh token is expired or invalid (the API returns
 * `400 invalid_grant`). The user must re-link their account.
 */
class RefreshTokenInvalidError extends AuthenticationError {
    code = 'REFRESH_TOKEN_INVALID';
    constructor(message = 'Refresh token is expired or invalid; re-link required', options) {
        super(message, options);
    }
}
exports.RefreshTokenInvalidError = RefreshTokenInvalidError;
/** Network-level failure (DNS, connection reset, etc.). Safe to retry. */
class NetworkError extends ResideoError {
    code = 'NETWORK_ERROR';
    isRetryable = true;
}
exports.NetworkError = NetworkError;
/** Request exceeded the configured timeout. Safe to retry. */
class TimeoutError extends ResideoError {
    code = 'TIMEOUT_ERROR';
    isRetryable = true;
}
exports.TimeoutError = TimeoutError;
/** Rate limited by the API (429). Retryable with backoff. */
class RateLimitError extends ResideoError {
    code = 'RATE_LIMIT_ERROR';
    isRetryable = true;
    httpStatus = 429;
}
exports.RateLimitError = RateLimitError;
/** Non-2xx API response that isn't auth/rate-limit. Retryable only for 5xx. */
class ApiResponseError extends ResideoError {
    code = 'API_RESPONSE_ERROR';
    isRetryable;
    httpStatus;
    constructor(status, message, options) {
        super(message, options);
        this.httpStatus = status;
        this.isRetryable = status >= 500;
    }
}
exports.ApiResponseError = ApiResponseError;
/** Response body could not be parsed as expected (e.g. invalid JSON). */
class ApiParseError extends ResideoError {
    code = 'API_PARSE_ERROR';
    isRetryable = false;
}
exports.ApiParseError = ApiParseError;
/**
 * Map an HTTP status code to the appropriate error type.
 */
function createApiError(status, message, cause) {
    if (status === 401 || status === 403) {
        return new AuthenticationError(message, cause ? { cause } : undefined);
    }
    if (status === 429) {
        return new RateLimitError(message, cause ? { cause } : undefined);
    }
    return new ApiResponseError(status, message, cause ? { cause } : undefined);
}
//# sourceMappingURL=index.js.map