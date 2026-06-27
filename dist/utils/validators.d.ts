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
 * Validate the platform configuration block. Pure and side-effect free so it is
 * trivially unit-testable; the caller decides how to surface the results.
 */
export declare function validateConfig(config: ResideoPlatformConfig | undefined): ConfigValidationResult;
//# sourceMappingURL=validators.d.ts.map