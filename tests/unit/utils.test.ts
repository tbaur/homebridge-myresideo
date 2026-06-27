/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import {
  clampBatteryLevel,
  isDeviceActive,
  isFreezing,
  isLeakDetected,
  isLowBattery,
  isWaterLeakDetector,
  resolveFreezeThreshold,
} from '../../src/utils'

describe('isLeakDetected', () => {
  it('is true only when waterPresent is true', () => {
    expect(isLeakDetected({ waterPresent: true })).toBe(true)
    expect(isLeakDetected({ waterPresent: false })).toBe(false)
  })
})

describe('isLowBattery', () => {
  it('is true at or below the threshold', () => {
    expect(isLowBattery(10)).toBe(true)
    expect(isLowBattery(15)).toBe(true)
    expect(isLowBattery(16)).toBe(false)
  })

  it('respects a custom threshold', () => {
    expect(isLowBattery(25, 30)).toBe(true)
  })

  it('returns false for missing/invalid readings', () => {
    expect(isLowBattery(undefined)).toBe(false)
    expect(isLowBattery(Number.NaN)).toBe(false)
  })
})

describe('resolveFreezeThreshold', () => {
  it('prefers an explicit override', () => {
    expect(resolveFreezeThreshold({ deviceSettings: { temp: { low: { limit: 7 } } } }, 2)).toBe(2)
  })

  it('falls back to the device low-temp limit', () => {
    expect(resolveFreezeThreshold({ deviceSettings: { temp: { low: { limit: 6.5 } } } })).toBe(6.5)
  })

  it('falls back to the plugin default when nothing is set', () => {
    expect(resolveFreezeThreshold({})).toBe(4)
  })
})

describe('isFreezing', () => {
  it('is true at or below the threshold', () => {
    expect(isFreezing(4, 4)).toBe(true)
    expect(isFreezing(1.5, 4)).toBe(true)
  })

  it('is false above the threshold', () => {
    expect(isFreezing(20, 4)).toBe(false)
  })

  it('is false (fail-safe) when no reading is available', () => {
    expect(isFreezing(undefined, 4)).toBe(false)
    expect(isFreezing(Number.NaN, 4)).toBe(false)
  })
})

describe('clampBatteryLevel', () => {
  it('clamps and rounds into 0-100', () => {
    expect(clampBatteryLevel(43.6)).toBe(44)
    expect(clampBatteryLevel(-5)).toBe(0)
    expect(clampBatteryLevel(150)).toBe(100)
  })

  it('returns undefined for invalid readings (no misleading default)', () => {
    expect(clampBatteryLevel(undefined)).toBeUndefined()
    expect(clampBatteryLevel(Number.NaN)).toBeUndefined()
  })
})

describe('isWaterLeakDetector', () => {
  it('matches the LeakDetector device class', () => {
    expect(isWaterLeakDetector({ deviceClass: 'LeakDetector' })).toBe(true)
    expect(isWaterLeakDetector({ deviceClass: 'Thermostat' })).toBe(false)
  })
})

describe('isDeviceActive', () => {
  it('is active when no negative signal is present', () => {
    expect(isDeviceActive({})).toBe(true)
    expect(isDeviceActive({ isAlive: true, isDeviceOffline: false, hasDeviceCheckedIn: true })).toBe(true)
  })

  it('is inactive when offline, not alive, or not checked in', () => {
    expect(isDeviceActive({ isDeviceOffline: true })).toBe(false)
    expect(isDeviceActive({ isAlive: false })).toBe(false)
    expect(isDeviceActive({ hasDeviceCheckedIn: false })).toBe(false)
  })
})
