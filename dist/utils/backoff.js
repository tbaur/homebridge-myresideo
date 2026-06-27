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
/** Resolve after `ms` milliseconds. */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/**
 * Exponential backoff with a small base and a hard cap. `attempt` is 1-indexed,
 * so the first retry waits `base`, the second `2*base`, etc.
 */
function backoffMs(attempt, base = 1000, cap = 8000) {
    return Math.min(base * 2 ** (attempt - 1), cap);
}
//# sourceMappingURL=backoff.js.map