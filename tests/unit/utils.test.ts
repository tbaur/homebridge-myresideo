/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import {
  activeAlarmTypes,
  clampBatteryLevel,
  describeDeviceState,
  hasActiveAlarms,
  isDeviceActive,
  isFreezing,
  isLeakDetected,
  isLowBattery,
  isWaterLeakDetector,
  resolveFreezeThreshold,
} from '../../src/utils'
import type { WaterLeakDetector } from '../../src/types'

/** Build a healthy water leak detector fixture, overriding only what a test needs. */
function makeDevice(overrides: Partial<WaterLeakDetector> = {}): WaterLeakDetector {
  return {
    deviceID: 'LCC-001',
    deviceClass: 'LeakDetector',
    deviceType: 'Water Leak Detector',
    waterPresent: false,
    batteryRemaining: 92,
    currentSensorReadings: { time: '2026-06-29T12:00:00', temperature: 21.5, humidity: 47 },
    ...overrides,
  } as WaterLeakDetector
}

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

describe('hasActiveAlarms', () => {
  it('is true only for a non-empty alarm array', () => {
    expect(hasActiveAlarms({ currentAlarms: [{ type: 'HighHumidity' }] })).toBe(true)
    expect(hasActiveAlarms({ currentAlarms: [] })).toBe(false)
  })

  it('is false (fail-safe) when the field is missing or malformed', () => {
    expect(hasActiveAlarms({})).toBe(false)
    expect(hasActiveAlarms({ currentAlarms: undefined })).toBe(false)
    expect(hasActiveAlarms({ currentAlarms: 'oops' as unknown as [] })).toBe(false)
  })
})

describe('activeAlarmTypes', () => {
  it('returns distinct, in-order, non-empty type strings', () => {
    expect(activeAlarmTypes({
      currentAlarms: [
        { type: 'HighTemperature', created: '2026-01-01T00:00:00' },
        { type: 'HighHumidity' },
        { type: 'HighTemperature' },
      ],
    })).toEqual(['HighTemperature', 'HighHumidity'])
  })

  it('ignores entries without a usable type and tolerates malformed input', () => {
    expect(activeAlarmTypes({ currentAlarms: [{ created: '2026-01-01T00:00:00' }, { type: '' }] })).toEqual([])
    expect(activeAlarmTypes({})).toEqual([])
    expect(activeAlarmTypes({ currentAlarms: 'oops' as unknown as [] })).toEqual([])
  })
})

describe('describeDeviceState', () => {
  it('renders a healthy device calmly in lowercase', () => {
    expect(describeDeviceState(makeDevice(), {})).toBe('online | dry | 21.5°C | 47% RH | battery 92%')
  })

  it('capitalizes problems: offline, leak, low battery, and active alarms', () => {
    const device = makeDevice({
      isDeviceOffline: true,
      waterPresent: true,
      batteryRemaining: 12,
      currentAlarms: [{ type: 'HighHumidity' }],
    })
    expect(describeDeviceState(device, {})).toBe(
      'OFFLINE | LEAK DETECTED | 21.5°C | 47% RH | battery 12% (LOW) | alarms: HighHumidity',
    )
  })

  it('annotates freezing only when the freeze sensor is enabled', () => {
    const cold = makeDevice({ currentSensorReadings: { time: '2026-06-29T12:00:00', temperature: 3.5, humidity: 61 } })
    expect(describeDeviceState(cold, { enableFreezeSensor: true })).toBe(
      'online | dry | 3.5°C (FREEZING ≤ 4°C) | 61% RH | battery 92%',
    )
    // Same cold reading, but the freeze sensor is off: no freeze annotation.
    expect(describeDeviceState(cold, { enableFreezeSensor: false })).toBe(
      'online | dry | 3.5°C | 61% RH | battery 92%',
    )
  })

  it('uses an explicit per-device freeze threshold override in the annotation', () => {
    const cold = makeDevice({ currentSensorReadings: { time: '2026-06-29T12:00:00', temperature: 1, humidity: 50 } })
    expect(describeDeviceState(cold, { enableFreezeSensor: true, freezeThresholdCelsius: 2 })).toBe(
      'online | dry | 1°C (FREEZING ≤ 2°C) | 50% RH | battery 92%',
    )
  })

  it('renders missing readings as n/a rather than misleading defaults', () => {
    const device = makeDevice({ batteryRemaining: undefined, currentSensorReadings: undefined })
    expect(describeDeviceState(device, {})).toBe('online | dry | temp n/a | humidity n/a | battery n/a')
  })

  it('treats NaN temperature/humidity as n/a (not "NaN°C")', () => {
    const device = makeDevice({
      currentSensorReadings: { time: '2026-06-29T12:00:00', temperature: Number.NaN, humidity: Number.NaN },
    })
    expect(describeDeviceState(device, {})).toBe('online | dry | temp n/a | humidity n/a | battery 92%')
  })

  it('resolves the freeze threshold from the device low-temp limit when no override is set', () => {
    const cold = makeDevice({
      currentSensorReadings: { time: '2026-06-29T12:00:00', temperature: 5, humidity: 50 },
      deviceSettings: { temp: { low: { limit: 6 } } },
    })
    expect(describeDeviceState(cold, { enableFreezeSensor: true })).toBe(
      'online | dry | 5°C (FREEZING ≤ 6°C) | 50% RH | battery 92%',
    )
  })

  it('rounds the battery reading for display', () => {
    expect(describeDeviceState(makeDevice({ batteryRemaining: 43.6 }), {})).toContain('battery 44%')
  })

  it('omits the alarms segment when no alarm carries a usable type', () => {
    const device = makeDevice({ currentAlarms: [{ created: '2026-06-29T12:00:00' }] })
    expect(describeDeviceState(device, {})).toBe('online | dry | 21.5°C | 47% RH | battery 92%')
  })
})
