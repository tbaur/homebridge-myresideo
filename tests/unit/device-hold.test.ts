/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Offline hold: keep the last trusted state through a short
 * unreachable report, and believe a long one.
 */

import { DeviceHold, withoutPlaceholderBattery } from '../../src/device-hold'
import type { WaterLeakDetector } from '../../src/types'

const HOLD_MS = 10 * 60_000

function healthy(overrides: Partial<WaterLeakDetector> = {}): WaterLeakDetector {
  return {
    deviceID: 'dev-1',
    deviceClass: 'LeakDetector',
    deviceType: 'Water Leak Detector',
    waterPresent: false,
    isAlive: true,
    isDeviceOffline: false,
    hasDeviceCheckedIn: true,
    batteryRemaining: 70,
    currentSensorReadings: { time: '2026-01-01T00:00:00Z', temperature: 21, humidity: 50 },
    currentAlarms: [{ type: 'HighHumidity' }],
    ...overrides,
  }
}

/** The record Resideo returns during a cloud incident. */
function placeholder(overrides: Partial<WaterLeakDetector> = {}): WaterLeakDetector {
  return {
    deviceID: 'dev-1',
    deviceClass: 'LeakDetector',
    deviceType: 'Water Leak Detector',
    waterPresent: false,
    isAlive: false,
    isDeviceOffline: true,
    hasDeviceCheckedIn: false,
    batteryRemaining: 0,
    currentAlarms: [],
    ...overrides,
  }
}

describe('DeviceHold', () => {
  let now: number
  let hold: DeviceHold

  beforeEach(() => {
    now = 1_000_000
    hold = new DeviceHold(HOLD_MS, () => now)
  })

  it('passes a reachable record through unchanged', () => {
    const device = healthy()
    expect(hold.apply(device)).toEqual({ device, isOfflineHeld: false })
  })

  it('keeps the last trusted record during the hold, including battery, readings and alarms', () => {
    const trusted = healthy()
    hold.apply(trusted)
    now += 2 * 60_000

    expect(hold.apply(placeholder())).toEqual({ device: trusted, isOfflineHeld: true })
  })

  it('passes a leak through during the hold', () => {
    hold.apply(healthy())
    const result = hold.apply(placeholder({ waterPresent: true }))

    expect(result.isOfflineHeld).toBe(true)
    expect(result.device.waterPresent).toBe(true)
    expect(result.device.isAlive).toBe(true)
  })

  it('does not let a dry placeholder clear a leak during the hold', () => {
    hold.apply(healthy({ waterPresent: true }))
    const result = hold.apply(placeholder({ waterPresent: false }))

    expect(result.isOfflineHeld).toBe(true)
    expect(result.device.waterPresent).toBe(true)
  })

  it('reports offline once the hold has elapsed, without the placeholder battery', () => {
    hold.apply(healthy())
    hold.apply(placeholder())
    now += HOLD_MS - 1
    expect(hold.apply(placeholder()).isOfflineHeld).toBe(true)

    now += 1
    const result = hold.apply(placeholder())
    expect(result.isOfflineHeld).toBe(false)
    expect(result.device.isAlive).toBe(false)
    expect(result.device).not.toHaveProperty('batteryRemaining')
  })

  it('starts a new hold after the detector comes back', () => {
    hold.apply(healthy())
    hold.apply(placeholder())
    now += HOLD_MS - 1
    hold.apply(healthy())
    now += 1

    expect(hold.apply(placeholder()).isOfflineHeld).toBe(true)
  })

  it('holds a placeholder with no trusted record but shows it as reported', () => {
    const result = hold.apply(placeholder())

    expect(result.isOfflineHeld).toBe(true)
    expect(result.device.isAlive).toBe(false)
    expect(result.device).not.toHaveProperty('batteryRemaining')
  })

  it('holds against a seeded cached record at boot', () => {
    const cached = healthy()
    hold.seed(cached)

    expect(hold.apply(placeholder())).toEqual({ device: cached, isOfflineHeld: true })
  })

  it('does not seed from an unreachable or missing record, or over a live one', () => {
    hold.seed(undefined)
    hold.seed(placeholder())
    expect(hold.apply(placeholder()).device.isAlive).toBe(false)

    const live = healthy({ batteryRemaining: 55 })
    const fresh = new DeviceHold(HOLD_MS, () => now)
    fresh.apply(live)
    fresh.seed(healthy({ batteryRemaining: 99 }))
    expect(fresh.apply(placeholder()).device).toEqual(live)
  })

  it('forgets a released detector', () => {
    hold.apply(healthy())
    hold.release('dev-1')

    expect(hold.apply(placeholder()).device.isAlive).toBe(false)
  })

  it('reports offline on the first unreachable record when the hold is zero', () => {
    const noHold = new DeviceHold(0, () => now)
    noHold.apply(healthy())

    expect(noHold.apply(placeholder()).isOfflineHeld).toBe(false)
  })
})

describe('withoutPlaceholderBattery', () => {
  it('keeps the battery on a reachable record', () => {
    expect(withoutPlaceholderBattery(healthy()).batteryRemaining).toBe(70)
  })

  it('drops the battery from an unreachable record', () => {
    expect(withoutPlaceholderBattery(placeholder())).not.toHaveProperty('batteryRemaining')
  })

  it('returns an unreachable record with no battery as is', () => {
    const device = placeholder({ batteryRemaining: undefined })
    expect(withoutPlaceholderBattery(device)).toBe(device)
  })
})
