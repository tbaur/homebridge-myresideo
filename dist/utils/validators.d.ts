/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Configuration validation. Validates the Homebridge platform
 * config at startup so misconfiguration fails fast with an actionable message
 * instead of surfacing as an opaque runtime error later.
 */
import type { ResideoPlatformConfig } from '../types';
/**
 * Outcome of validating the platform config.
 *
 * `errors` are fatal — the plugin cannot start. `warnings` are non-fatal — the
 * plugin starts but a value was missing/out of range and a default was applied.
 */
export interface ConfigValidationResult {
    errors: string[];
    warnings: string[];
}
/**
 * Return a freeze threshold only when it is a usable number within the
 * plausible range, otherwise `undefined`. Callers fall back to the device's own
 * limit (or the plugin default), which is exactly what {@link validateConfig}
 * warns about for an out-of-range value, keeping the warning and the runtime
 * behavior in agreement.
 */
export declare function sanitizeFreezeThreshold(value: number | undefined): number | undefined;
/**
 * Validate the platform configuration block. Pure and side-effect free so it is
 * trivially unit-testable; the caller decides how to surface the results.
 */
export declare function validateConfig(config: ResideoPlatformConfig | undefined): ConfigValidationResult;
//# sourceMappingURL=validators.d.ts.map