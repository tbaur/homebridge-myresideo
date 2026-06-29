/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Pure helper functions for mapping Honeywell device state to
 * HomeKit-friendly values. Kept side-effect free so they are trivially testable.
 */
import type { LeakDetectorOptions, WaterLeakDetector } from '../types';
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
 * True when the device reports at least one active alarm (e.g. HighTemperature,
 * HighHumidity, DeviceOffline). The array is empty on healthy devices. Guarded
 * with `Array.isArray` so a malformed/absent payload is treated as "no alarm"
 * rather than throwing.
 */
export declare function hasActiveAlarms(device: Pick<WaterLeakDetector, 'currentAlarms'>): boolean;
/**
 * The distinct, non-empty alarm `type` strings currently active on a device, in
 * first-seen order. Useful for human-readable diagnostics; returns an empty
 * array when there are no alarms or none carry a usable `type`.
 */
export declare function activeAlarmTypes(device: Pick<WaterLeakDetector, 'currentAlarms'>): string[];
/**
 * True when the device should be reported as active in HomeKit. Treats an
 * explicit offline/not-alive/not-checked-in signal as inactive; missing fields
 * are optimistically treated as active (the API omits them for healthy devices).
 */
export declare function isDeviceActive(device: Pick<WaterLeakDetector, 'isAlive' | 'isDeviceOffline' | 'hasDeviceCheckedIn'>): boolean;
/**
 * Build a one-line, human-readable summary of a detector's state for the startup
 * discovery log. Healthy conditions render lowercase (`online`, `dry`); problems
 * (`OFFLINE`, `LEAK DETECTED`, `(LOW)`, `(FREEZING …)`, active alarms) are
 * capitalized so they stand out when scanning the boot log. Missing readings
 * render as `n/a` rather than a misleading default. The freeze annotation is
 * only shown when the freeze sensor is enabled and a real temperature backs it,
 * matching what is actually exposed to HomeKit. Carries no account data.
 *
 * Segments are pipe-delimited to match the diagnostics `Health:` line, so the
 * boot summary and the periodic health report read consistently in the log.
 */
export declare function describeDeviceState(device: WaterLeakDetector, options: Pick<LeakDetectorOptions, 'enableFreezeSensor' | 'freezeThresholdCelsius'>, defaultFreezeThreshold?: number): string;
//# sourceMappingURL=mappers.d.ts.map