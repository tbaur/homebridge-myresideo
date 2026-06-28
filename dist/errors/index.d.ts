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
export declare abstract class ResideoError extends Error {
    abstract readonly code: string;
    abstract readonly isRetryable: boolean;
    readonly httpStatus?: number;
    readonly timestamp: Date;
    constructor(message: string, options?: {
        cause?: Error;
    });
    toJSON(): Record<string, unknown>;
}
/** Configuration is missing or invalid; not recoverable without user action. */
export declare class ConfigurationError extends ResideoError {
    readonly code = "CONFIG_ERROR";
    readonly isRetryable = false;
}
/** Input/argument validation failure. */
export declare class ValidationError extends ResideoError {
    readonly code = "VALIDATION_ERROR";
    readonly isRetryable = false;
}
/**
 * Authentication/authorization failure (401/403). Never retried by the HTTP
 * client; the platform's token manager handles refresh-and-retry instead.
 */
export declare class AuthenticationError extends ResideoError {
    readonly code: string;
    readonly isRetryable = false;
    readonly httpStatus = 401;
    constructor(message?: string, options?: {
        cause?: Error;
    });
}
/**
 * The OAuth refresh token is expired or invalid (the API returns
 * `400 invalid_grant`). The user must re-link their account.
 */
export declare class RefreshTokenInvalidError extends AuthenticationError {
    readonly code: string;
    constructor(message?: string, options?: {
        cause?: Error;
    });
}
/**
 * Authenticated but not authorized (403). Distinct from {@link AuthenticationError}
 * (401) because refreshing the token cannot fix a permissions problem, so the
 * client must not waste a refresh-and-retry on it.
 */
export declare class ForbiddenError extends ResideoError {
    readonly code = "FORBIDDEN_ERROR";
    readonly isRetryable = false;
    readonly httpStatus = 403;
}
/** Network-level failure (DNS, connection reset, etc.). Safe to retry. */
export declare class NetworkError extends ResideoError {
    readonly code = "NETWORK_ERROR";
    readonly isRetryable = true;
}
/** Request exceeded the configured timeout. Safe to retry. */
export declare class TimeoutError extends ResideoError {
    readonly code = "TIMEOUT_ERROR";
    readonly isRetryable = true;
}
/** Rate limited by the API (429). Retryable with backoff. */
export declare class RateLimitError extends ResideoError {
    readonly code = "RATE_LIMIT_ERROR";
    readonly isRetryable = true;
    readonly httpStatus = 429;
}
/** Non-2xx API response that isn't auth/rate-limit. Retryable only for 5xx. */
export declare class ApiResponseError extends ResideoError {
    readonly code = "API_RESPONSE_ERROR";
    readonly isRetryable: boolean;
    readonly httpStatus: number;
    constructor(status: number, message: string, options?: {
        cause?: Error;
    });
}
/** Response body could not be parsed as expected (e.g. invalid JSON). */
export declare class ApiParseError extends ResideoError {
    readonly code = "API_PARSE_ERROR";
    readonly isRetryable = false;
}
/**
 * Map an HTTP status code to the appropriate error type.
 */
export declare function createApiError(status: number, message: string, cause?: Error): ResideoError;
//# sourceMappingURL=index.d.ts.map