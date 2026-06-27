/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Shared backoff/delay helpers used by the HTTP client and the
 * OAuth token manager so retry behavior is consistent across the codebase.
 */
/** Resolve after `ms` milliseconds. */
export declare function delay(ms: number): Promise<void>;
/**
 * Exponential backoff with a small base and a hard cap. `attempt` is 1-indexed,
 * so the first retry waits `base`, the second `2*base`, etc.
 */
export declare function backoffMs(attempt: number, base?: number, cap?: number): number;
//# sourceMappingURL=backoff.d.ts.map