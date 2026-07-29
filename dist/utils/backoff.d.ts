/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Shared backoff/delay helpers used by the HTTP client and the
 * OAuth token manager so retry behavior is consistent across the codebase.
 */
/**
 * Resolve after `ms` milliseconds.
 *
 * NOTE: the timer is intentionally not cancelable — it only spaces out retries, and
 * in-flight requests already have their own timeouts. It is `unref`ed instead,
 * because the wait is not always short: a server-supplied `Retry-After` can park a
 * retry for up to {@link MAX_RETRY_AFTER_MS}, far longer than Homebridge's shutdown
 * window, and a referenced timer would hold the process open for the remainder.
 */
export declare function delay(ms: number): Promise<void>;
/**
 * Exponential backoff with a small base and a hard cap, plus full +/-20% jitter
 * to avoid synchronized retries (thundering herd). `attempt` is 1-indexed, so
 * the first retry waits ~`base`, the second ~`2*base`, etc.
 */
export declare function backoffMs(attempt: number, base?: number, cap?: number): number;
/**
 * Parse an HTTP `Retry-After` header into milliseconds. Supports the
 * delta-seconds and HTTP-date forms, clamps to {@link MAX_RETRY_AFTER_MS}, and
 * returns `undefined` when the header is absent or unparseable (callers fall
 * back to exponential backoff).
 */
export declare function parseRetryAfterMs(header: string | string[] | undefined): number | undefined;
//# sourceMappingURL=backoff.d.ts.map