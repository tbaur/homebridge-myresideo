"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Pure helper functions for mapping Honeywell device state to
 * HomeKit-friendly values. Kept side-effect free so they are trivially testable.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isLeakDetected = isLeakDetected;
exports.isLowBattery = isLowBattery;
exports.resolveFreezeThreshold = resolveFreezeThreshold;
exports.isFreezing = isFreezing;
exports.clampBatteryLevel = clampBatteryLevel;
exports.isWaterLeakDetector = isWaterLeakDetector;
const settings_1 = require("./settings");
/** True when liquid water is currently detected. */
function isLeakDetected(device) {
    return device.waterPresent === true;
}
/** True when battery percentage is at or below the low-battery threshold. */
function isLowBattery(batteryRemaining, threshold = settings_1.LOW_BATTERY_THRESHOLD) {
    if (typeof batteryRemaining !== 'number' || Number.isNaN(batteryRemaining)) {
        return false;
    }
    return batteryRemaining <= threshold;
}
/**
 * Resolve the freeze threshold (Celsius) for a device, preferring an explicit
 * override, then the device's own configured low-temperature alert limit, then
 * the plugin default.
 */
function resolveFreezeThreshold(device, override) {
    if (typeof override === 'number' && !Number.isNaN(override)) {
        return override;
    }
    const deviceLimit = device.deviceSettings?.temp?.low?.limit;
    if (typeof deviceLimit === 'number' && !Number.isNaN(deviceLimit)) {
        return deviceLimit;
    }
    return settings_1.DEFAULT_FREEZE_THRESHOLD_C;
}
/**
 * True when the latest temperature reading is at or below the freeze threshold.
 * Returns false when no reading is available (fail-safe: don't assert a freeze
 * we can't substantiate).
 */
function isFreezing(temperatureC, threshold) {
    if (typeof temperatureC !== 'number' || Number.isNaN(temperatureC)) {
        return false;
    }
    return temperatureC <= threshold;
}
/** Clamp a battery reading to the valid HomeKit 0-100 range. */
function clampBatteryLevel(batteryRemaining) {
    if (typeof batteryRemaining !== 'number' || Number.isNaN(batteryRemaining)) {
        return 100;
    }
    return Math.max(0, Math.min(100, Math.round(batteryRemaining)));
}
/** Identify whether an API device record is a water leak detector. */
function isWaterLeakDetector(device) {
    return device.deviceClass === 'LeakDetector';
}
//# sourceMappingURL=utils.js.map