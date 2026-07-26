"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Shared backoff/delay helpers used by the HTTP client and the
 * OAuth token manager so retry behavior is consistent across the codebase.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.delay = delay;
exports.backoffMs = backoffMs;
exports.parseRetryAfterMs = parseRetryAfterMs;
const settings_1 = require("../settings");
/**
 * Resolve after `ms` milliseconds.
 *
 * NOTE: the returned timer is intentionally not cancelable. It is only used to
 * space out retries, the maximum wait is small and bounded (see {@link backoffMs}),
 * and in-flight requests already have their own timeouts, so a pending delay
 * during shutdown clears itself well within Homebridge's shutdown window.
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/**
 * Exponential backoff with a small base and a hard cap, plus full +/-20% jitter
 * to avoid synchronized retries (thundering herd). `attempt` is 1-indexed, so
 * the first retry waits ~`base`, the second ~`2*base`, etc.
 */
function backoffMs(attempt, base = 1000, cap = 8000) {
    const exponential = Math.min(base * 2 ** (attempt - 1), cap);
    const jitter = exponential * 0.2 * (Math.random() * 2 - 1);
    return Math.max(0, Math.round(exponential + jitter));
}
/**
 * Parse an HTTP `Retry-After` header into milliseconds. Supports the
 * delta-seconds and HTTP-date forms, clamps to {@link MAX_RETRY_AFTER_MS}, and
 * returns `undefined` when the header is absent or unparseable (callers fall
 * back to exponential backoff).
 */
function parseRetryAfterMs(header) {
    const value = Array.isArray(header) ? header[0] : header;
    if (!value) {
        return undefined;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(seconds * 1000, settings_1.MAX_RETRY_AFTER_MS);
    }
    const dateMs = Date.parse(trimmed);
    if (!Number.isNaN(dateMs)) {
        const deltaMs = dateMs - Date.now();
        return Math.min(Math.max(deltaMs, 0), settings_1.MAX_RETRY_AFTER_MS);
    }
    return undefined;
}
//# sourceMappingURL=backoff.js.map