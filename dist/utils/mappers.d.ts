/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Pure helper functions for mapping Honeywell device state to
 * HomeKit-friendly values. Kept side-effect free so they are trivially testable.
 */
import type { WaterLeakDetector } from '../types';
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
/**
 * Clamp a battery reading to the valid HomeKit 0-100 range, or return
 * `undefined` when no usable reading is available so callers can avoid
 * asserting a misleading default (e.g. a fake "100%" during an outage).
 */
export declare function clampBatteryLevel(batteryRemaining: number | undefined): number | undefined;
/** Identify whether an API device record is a water leak detector. */
export declare function isWaterLeakDetector(device: Pick<WaterLeakDetector, 'deviceClass'>): boolean;
/**
 * True when the device should be reported as active in HomeKit. Treats an
 * explicit offline/not-alive/not-checked-in signal as inactive; missing fields
 * are optimistically treated as active (the API omits them for healthy devices).
 */
export declare function isDeviceActive(device: Pick<WaterLeakDetector, 'isAlive' | 'isDeviceOffline' | 'hasDeviceCheckedIn'>): boolean;
//# sourceMappingURL=mappers.d.ts.map