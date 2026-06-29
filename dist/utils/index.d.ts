/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Utility barrel exports.
 */
export { isLeakDetected, isLowBattery, resolveFreezeThreshold, isFreezing, clampBatteryLevel, isWaterLeakDetector, isDeviceActive, hasActiveAlarms, activeAlarmTypes, } from './mappers';
export { backoffMs, delay } from './backoff';
export { sanitizeString, sanitizeError, maskToken, } from './sanitizers';
export { validateConfig, sanitizeFreezeThreshold } from './validators';
export type { ConfigValidationResult } from './validators';
//# sourceMappingURL=index.d.ts.map