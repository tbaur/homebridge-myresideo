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
exports.hasActiveAlarms = hasActiveAlarms;
exports.activeAlarmTypes = activeAlarmTypes;
exports.isDeviceActive = isDeviceActive;
exports.describeDeviceState = describeDeviceState;
const settings_1 = require("../settings");
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
/**
 * Clamp a battery reading to the valid HomeKit 0-100 range, or return
 * `undefined` when no usable reading is available so callers can avoid
 * asserting a misleading default (e.g. a fake "100%" during an outage).
 */
function clampBatteryLevel(batteryRemaining) {
    if (typeof batteryRemaining !== 'number' || Number.isNaN(batteryRemaining)) {
        return undefined;
    }
    return Math.max(0, Math.min(100, Math.round(batteryRemaining)));
}
/** Identify whether an API device record is a water leak detector. */
function isWaterLeakDetector(device) {
    return device.deviceClass === settings_1.LEAK_DETECTOR_DEVICE_CLASS;
}
/**
 * True when the device reports at least one active alarm (e.g. HighTemperature,
 * HighHumidity, DeviceOffline). The array is empty on healthy devices. Guarded
 * with `Array.isArray` so a malformed/absent payload is treated as "no alarm"
 * rather than throwing.
 */
function hasActiveAlarms(device) {
    return Array.isArray(device.currentAlarms) && device.currentAlarms.length > 0;
}
/**
 * The distinct, non-empty alarm `type` strings currently active on a device, in
 * first-seen order. Useful for human-readable diagnostics; returns an empty
 * array when there are no alarms or none carry a usable `type`.
 */
function activeAlarmTypes(device) {
    if (!Array.isArray(device.currentAlarms)) {
        return [];
    }
    const types = [];
    for (const alarm of device.currentAlarms) {
        const type = alarm?.type;
        if (typeof type === 'string' && type.length > 0 && !types.includes(type)) {
            types.push(type);
        }
    }
    return types;
}
/**
 * True when the device should be reported as active in HomeKit. Treats an
 * explicit offline/not-alive/not-checked-in signal as inactive; missing fields
 * are optimistically treated as active (the API omits them for healthy devices).
 */
function isDeviceActive(device) {
    return device.isAlive !== false
        && device.isDeviceOffline !== true
        && device.hasDeviceCheckedIn !== false;
}
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
function describeDeviceState(device, options, defaultFreezeThreshold) {
    const parts = [
        isDeviceActive(device) ? 'online' : 'OFFLINE',
        isLeakDetected(device) ? 'LEAK DETECTED' : 'dry',
    ];
    const temperature = device.currentSensorReadings?.temperature;
    if (typeof temperature === 'number' && Number.isFinite(temperature)) {
        const threshold = resolveFreezeThreshold(device, options.freezeThresholdCelsius ?? defaultFreezeThreshold);
        const freezing = options.enableFreezeSensor === true && isFreezing(temperature, threshold);
        parts.push(`${temperature}°C${freezing ? ` (FREEZING ≤ ${threshold}°C)` : ''}`);
    }
    else {
        parts.push('temp n/a');
    }
    const humidity = device.currentSensorReadings?.humidity;
    parts.push(typeof humidity === 'number' && Number.isFinite(humidity) ? `${humidity}% RH` : 'humidity n/a');
    const battery = clampBatteryLevel(device.batteryRemaining);
    parts.push(battery === undefined
        ? 'battery n/a'
        : `battery ${battery}%${isLowBattery(device.batteryRemaining) ? ' (LOW)' : ''}`);
    const alarms = activeAlarmTypes(device);
    if (alarms.length > 0) {
        parts.push(`alarms: ${alarms.join(', ')}`);
    }
    return parts.join(' | ');
}
//# sourceMappingURL=mappers.js.map