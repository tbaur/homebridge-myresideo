/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Pure helper functions for mapping Honeywell device state to
 * HomeKit-friendly values. Kept side-effect free so they are trivially testable.
 */

import { DEFAULT_FREEZE_THRESHOLD_C, LOW_BATTERY_THRESHOLD } from '../settings'
import type { WaterLeakDetector } from '../types'

/** True when liquid water is currently detected. */
export function isLeakDetected(device: Pick<WaterLeakDetector, 'waterPresent'>): boolean {
  return device.waterPresent === true
}

/** True when battery percentage is at or below the low-battery threshold. */
export function isLowBattery(batteryRemaining: number | undefined, threshold = LOW_BATTERY_THRESHOLD): boolean {
  if (typeof batteryRemaining !== 'number' || Number.isNaN(batteryRemaining)) {
    return false
  }
  return batteryRemaining <= threshold
}

/**
 * Resolve the freeze threshold (Celsius) for a device, preferring an explicit
 * override, then the device's own configured low-temperature alert limit, then
 * the plugin default.
 */
export function resolveFreezeThreshold(
  device: Pick<WaterLeakDetector, 'deviceSettings'>,
  override?: number,
): number {
  if (typeof override === 'number' && !Number.isNaN(override)) {
    return override
  }
  const deviceLimit = device.deviceSettings?.temp?.low?.limit
  if (typeof deviceLimit === 'number' && !Number.isNaN(deviceLimit)) {
    return deviceLimit
  }
  return DEFAULT_FREEZE_THRESHOLD_C
}

/**
 * True when the latest temperature reading is at or below the freeze threshold.
 * Returns false when no reading is available (fail-safe: don't assert a freeze
 * we can't substantiate).
 */
export function isFreezing(temperatureC: number | undefined, threshold: number): boolean {
  if (typeof temperatureC !== 'number' || Number.isNaN(temperatureC)) {
    return false
  }
  return temperatureC <= threshold
}

/**
 * Clamp a battery reading to the valid HomeKit 0-100 range, or return
 * `undefined` when no usable reading is available so callers can avoid
 * asserting a misleading default (e.g. a fake "100%" during an outage).
 */
export function clampBatteryLevel(batteryRemaining: number | undefined): number | undefined {
  if (typeof batteryRemaining !== 'number' || Number.isNaN(batteryRemaining)) {
    return undefined
  }
  return Math.max(0, Math.min(100, Math.round(batteryRemaining)))
}

/** Identify whether an API device record is a water leak detector. */
export function isWaterLeakDetector(device: Pick<WaterLeakDetector, 'deviceClass'>): boolean {
  return device.deviceClass === 'LeakDetector'
}

/**
 * True when the device should be reported as active in HomeKit. Treats an
 * explicit offline/not-alive/not-checked-in signal as inactive; missing fields
 * are optimistically treated as active (the API omits them for healthy devices).
 */
export function isDeviceActive(
  device: Pick<WaterLeakDetector, 'isAlive' | 'isDeviceOffline' | 'hasDeviceCheckedIn'>,
): boolean {
  return device.isAlive !== false
    && device.isDeviceOffline !== true
    && device.hasDeviceCheckedIn !== false
}
