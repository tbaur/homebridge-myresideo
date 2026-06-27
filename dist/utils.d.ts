/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Pure helper functions for mapping Honeywell device state to
 * HomeKit-friendly values. Kept side-effect free so they are trivially testable.
 */
import type { WaterLeakDetector } from './types';
/** True when liquid water is currently detected. */
export declare function isLeakDetected(device: Pick<WaterLeakDetector, 'waterPresent'>): boolean;
/** True when battery percentage is at or below the low-battery threshold. */
export declare function isLowBattery(batteryRemaining: number | undefined, threshold?: number): boolean;
/**
 * Resolve the freeze threshold (Celsius) for a device, preferring an explicit
 * override, then the device's own configured low-temperature alert limit, then
 * the plugin default.
 */
export declare function resolveFreezeThreshold(device: Pick<WaterLeakDetector, 'deviceSettings'>, override?: number): number;
/**
 * True when the latest temperature reading is at or below the freeze threshold.
 * Returns false when no reading is available (fail-safe: don't assert a freeze
 * we can't substantiate).
 */
export declare function isFreezing(temperatureC: number | undefined, threshold: number): boolean;
/** Clamp a battery reading to the valid HomeKit 0-100 range. */
export declare function clampBatteryLevel(batteryRemaining: number | undefined): number;
/** Identify whether an API device record is a water leak detector. */
export declare function isWaterLeakDetector(device: Pick<WaterLeakDetector, 'deviceClass'>): boolean;
//# sourceMappingURL=utils.d.ts.map