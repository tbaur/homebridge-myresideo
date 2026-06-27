/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Data sanitization utilities. These keep secrets (API keys,
 * OAuth tokens, Authorization headers) out of logs and error messages.
 */
/** Remove sensitive data from an arbitrary string. */
export declare function sanitizeString(str: string): string;
/** Convert an unknown error to a sanitized, log-safe message. */
export declare function sanitizeError(err: unknown): string;
/**
 * Mask a secret token for logging, revealing only enough to correlate it
 * across log lines without exposing the value.
 */
export declare function maskToken(token: string | undefined | null): string;
//# sourceMappingURL=sanitizers.d.ts.map