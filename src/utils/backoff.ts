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
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Exponential backoff with a small base and a hard cap. `attempt` is 1-indexed,
 * so the first retry waits `base`, the second `2*base`, etc.
 */
export function backoffMs(attempt: number, base = 1000, cap = 8000): number {
  return Math.min(base * 2 ** (attempt - 1), cap)
}
