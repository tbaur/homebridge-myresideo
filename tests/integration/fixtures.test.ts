/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * Contract tests that feed synthetic-but-shape-accurate Resideo payloads through
 * the real native-https client (via nock) and the pure mappers. The fixtures use
 * fabricated IDs/names; they mirror the field shape verified against a live WLD3
 * response, not any real account data.
 */

import nock from 'nock'

import { ResideoApiClient } from '../../src/api/client'
import { API_BASE_URL } from '../../src/settings'
import type { TokenManager as TokenManagerType } from '../../src/api/auth'
import type { WaterLeakDetector } from '../../src/types'
import {
  clampBatteryLevel,
  isDeviceActive,
  isFreezing,
  isLeakDetected,
  isLowBattery,
  isWaterLeakDetector,
  resolveFreezeThreshold,
} from '../../src/utils'

import locationsFixture from '../fixtures/locations.json'
import deviceFixture from '../fixtures/waterLeakDetector.json'

const BASE = API_BASE_URL

function stubTokenManager() {
  return {
    getAccessToken: jest.fn().mockResolvedValue('access-token'),
    forceRefresh: jest.fn().mockResolvedValue('access-token'),
    getRefreshToken: jest.fn().mockReturnValue('refresh'),
  } as unknown as TokenManagerType
}

function findDevice(devices: WaterLeakDetector[], name: string): WaterLeakDetector {
  const device = devices.find(d => d.userDefinedDeviceName === name)
  if (!device) {
    throw new Error(`fixture device not found: ${name}`)
  }
  return device
}

afterEach(() => nock.cleanAll())
afterAll(() => nock.restore())

describe('locations fixture → client → mappers', () => {
  it('parses the locations payload and discovers only leak detectors', async () => {
    nock(BASE).get('/v2/locations').query({ apikey: 'my-key' }).reply(200, locationsFixture)

    const client = new ResideoApiClient({ tokenManager: stubTokenManager(), apikey: 'my-key' })
    const locations = await client.getLocations()

    expect(locations).toHaveLength(1)
    expect(locations[0].locationID).toBe(100001)

    const allDevices = (locations[0].devices ?? []) as WaterLeakDetector[]
    const leakDetectors = allDevices.filter(isWaterLeakDetector)
    expect(allDevices).toHaveLength(6)
    expect(leakDetectors).toHaveLength(5) // the Thermostat is excluded
  })

  it('maps each device to the expected HomeKit-facing state', async () => {
    nock(BASE).get('/v2/locations').query({ apikey: 'my-key' }).reply(200, locationsFixture)

    const client = new ResideoApiClient({ tokenManager: stubTokenManager(), apikey: 'my-key' })
    const locations = await client.getLocations()
    const devices = (locations[0].devices ?? []) as WaterLeakDetector[]

    const healthy = findDevice(devices, 'Healthy Detector')
    expect(isLeakDetected(healthy)).toBe(false)
    expect(isDeviceActive(healthy)).toBe(true)
    expect(isLowBattery(healthy.batteryRemaining)).toBe(false)
    expect(clampBatteryLevel(healthy.batteryRemaining)).toBe(90)

    const lowBattery = findDevice(devices, 'Low Battery Detector')
    expect(isLowBattery(lowBattery.batteryRemaining)).toBe(true)

    const leaking = findDevice(devices, 'Leaking Detector')
    expect(isLeakDetected(leaking)).toBe(true)

    const offlineCold = findDevice(devices, 'Offline Cold Detector')
    expect(isDeviceActive(offlineCold)).toBe(false)
    const threshold = resolveFreezeThreshold(offlineCold)
    expect(threshold).toBe(4) // device's temp.low.limit
    expect(isFreezing(offlineCold.currentSensorReadings?.temperature, threshold)).toBe(true)

    const noReadings = findDevice(devices, 'No Readings Detector')
    expect(noReadings.currentSensorReadings).toBeUndefined()
    expect(clampBatteryLevel(noReadings.batteryRemaining)).toBeUndefined()
    expect(isFreezing(noReadings.currentSensorReadings?.temperature, 4)).toBe(false)
  })
})

describe('single water-leak-detector fixture → client', () => {
  it('parses the dedicated device endpoint into the expected shape', async () => {
    nock(BASE)
      .get('/v2/devices/waterLeakDetectors/00000000-0000-4000-8000-000000000001')
      .query({ apikey: 'my-key', locationId: '100001' })
      .reply(200, deviceFixture)

    const client = new ResideoApiClient({ tokenManager: stubTokenManager(), apikey: 'my-key' })
    const device = await client.getWaterLeakDetector('00000000-0000-4000-8000-000000000001', 100001)

    expect(device.deviceClass).toBe('LeakDetector')
    expect(device.waterPresent).toBe(false)
    expect(device.currentSensorReadings?.temperature).toBe(20.5)
    expect(device.batteryRemaining).toBe(90)
    expect(device.deviceSettings?.temp?.low?.limit).toBe(4)
    expect(isWaterLeakDetector(device)).toBe(true)
    expect(isDeviceActive(device)).toBe(true)
  })
})
