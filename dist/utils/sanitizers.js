"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Data sanitization utilities. These keep secrets (API keys,
 * OAuth tokens, Authorization headers) out of logs and error messages.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeString = sanitizeString;
exports.sanitizeError = sanitizeError;
exports.maskToken = maskToken;
/**
 * Patterns for sensitive data that should be redacted from strings/logs.
 *
 * Order matters: the JSON forms run first so they win over the generic
 * key/value forms, and the `authorization` header form (which may carry a
 * `Bearer` scheme plus the token) is fully consumed so the token value never
 * survives.
 */
const SENSITIVE_PATTERNS = [
    { pattern: /"access_token"\s*:\s*"[^"]+"/gi, replacement: '"access_token":"***"' },
    { pattern: /"refresh_token"\s*:\s*"[^"]+"/gi, replacement: '"refresh_token":"***"' },
    { pattern: /"?(?:consumer_?secret|client_secret)"?\s*[=:]\s*"?[^&\s"']+"?/gi, replacement: 'consumerSecret=***' },
    { pattern: /apikey=[^&\s"']+/gi, replacement: 'apikey=***' },
    { pattern: /access_token[=:]\s*"?[^&\s"']+"?/gi, replacement: 'access_token=***' },
    { pattern: /refresh_token[=:]\s*"?[^&\s"']+"?/gi, replacement: 'refresh_token=***' },
    { pattern: /authorization[=:]\s*(?:bearer\s+|basic\s+)?[^\s,&"']+/gi, replacement: 'authorization=***' },
    { pattern: /\bbearer\s+[^\s,&"']+/gi, replacement: 'Bearer ***' },
    { pattern: /\bbasic\s+[A-Za-z0-9+/=]+/gi, replacement: 'Basic ***' },
];
/** Remove sensitive data from an arbitrary string. */
function sanitizeString(str) {
    let result = str;
    for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
        result = result.replace(pattern, replacement);
    }
    return result;
}
/** Convert an unknown error to a sanitized, log-safe message. */
function sanitizeError(err) {
    let message;
    if (err instanceof Error) {
        message = err.message;
    }
    else if (typeof err === 'string') {
        message = err;
    }
    else {
        message = String(err);
    }
    return sanitizeString(message);
}
/**
 * Mask a secret token for logging, revealing only enough to correlate it
 * across log lines without exposing the value.
 */
function maskToken(token) {
    if (!token || typeof token !== 'string') {
        return '***';
    }
    if (token.length <= 8) {
        return '***';
    }
    return `${token.slice(0, 4)}…${token.slice(-4)}`;
}
//# sourceMappingURL=sanitizers.js.map