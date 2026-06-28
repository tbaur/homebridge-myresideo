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
//# sourceMappingURL=backoff.js.map