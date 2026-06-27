/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Unit tests for LeakSensorAccessory with a mocked HAP surface.
 */

import { LeakSensorAccessory } from '../../src/devices/leak-sensor'
import type ResideoPlatform from '../../src/platform'
import type { LeakDetectorOptions, WaterLeakDetector } from '../../src/types'
import type { PlatformAccessory } from 'homebridge'

interface CharRef {
  id: string
  [key: string]: unknown
}

const mkChar = (id: string, extra: Record<string, unknown> = {}): CharRef => ({ id, ...extra })

const Characteristic = {
  Manufacturer: mkChar('Manufacturer'),
  Model: mkChar('Model'),
  SerialNumber: mkChar('SerialNumber'),
  FirmwareRevision: mkChar('FirmwareRevision'),
  Name: mkChar('Name'),
  StatusActive: mkChar('StatusActive'),
  BatteryLevel: mkChar('BatteryLevel'),
  CurrentTemperature: mkChar('CurrentTemperature'),
  CurrentRelativeHumidity: mkChar('CurrentRelativeHumidity'),
  LeakDetected: mkChar('LeakDetected', { LEAK_DETECTED: 1, LEAK_NOT_DETECTED: 0 }),
  StatusLowBattery: mkChar('StatusLowBattery', { BATTERY_LEVEL_LOW: 1, BATTERY_LEVEL_NORMAL: 0 }),
  ContactSensorState: mkChar('ContactSensorState', { CONTACT_DETECTED: 0, CONTACT_NOT_DETECTED: 1 }),
  StatusFault: mkChar('StatusFault', { NO_FAULT: 0, GENERAL_FAULT: 1 }),
}

const Service = {
  AccessoryInformation: 'AccessoryInformation',
  LeakSensor: 'LeakSensor',
  Battery: 'Battery',
  TemperatureSensor: 'TemperatureSensor',
  HumiditySensor: 'HumiditySensor',
  ContactSensor: 'ContactSensor',
}

interface MockService {
  type: string
  updates: Array<{ char: CharRef, value: unknown }>
  setCharacteristic: jest.Mock
  updateCharacteristic: jest.Mock
}

function makeService(type: string): MockService {
  const updates: Array<{ char: CharRef, value: unknown }> = []
  const svc: MockService = {
    type,
    updates,
    setCharacteristic: jest.fn(),
    updateCharacteristic: jest.fn(),
  }
  svc.setCharacteristic.mockImplementation(() => svc)
  svc.updateCharacteristic.mockImplementation((char: CharRef, value: unknown) => {
    updates.push({ char, value })
    return svc
  })
  return svc
}

function makeAccessory(device: WaterLeakDetector) {
  const services = new Map<string, MockService>()
  services.set(Service.AccessoryInformation, makeService(Service.AccessoryInformation))
  return {
    displayName: 'Test Detector',
    UUID: 'uuid-1',
    context: { device },
    getService: jest.fn((type: string) => services.get(type)),
    addService: jest.fn((type: string) => {
      const s = makeService(type)
      services.set(type, s)
      return s
    }),
    services,
  }
}

function latestValue(svc: MockService | undefined, char: CharRef): unknown {
  if (!svc) {
    return undefined
  }
  const matches = svc.updates.filter(u => u.char === char)
  return matches.length > 0 ? matches[matches.length - 1].value : undefined
}

function baseDevice(overrides: Partial<WaterLeakDetector> = {}): WaterLeakDetector {
  return {
    deviceID: 'dev-1',
    deviceClass: 'LeakDetector',
    deviceType: 'Water Leak Detector',
    waterPresent: false,
    ...overrides,
  }
}

function build(device: WaterLeakDetector, options: LeakDetectorOptions = { deviceID: 'dev-1' }, threshold?: number) {
  const accessory = makeAccessory(device)
  const platform = { Service, Characteristic } as unknown as ResideoPlatform
  const handler = new LeakSensorAccessory(
    platform,
    accessory as unknown as PlatformAccessory,
    options,
    threshold,
  )
  return { handler, accessory }
}

describe('LeakSensorAccessory', () => {
  it('reflects leak-detected state', () => {
    const { accessory } = build(baseDevice({ waterPresent: true }))
    const leak = accessory.services.get(Service.LeakSensor)
    expect(latestValue(leak, Characteristic.LeakDetected)).toBe(Characteristic.LeakDetected.LEAK_DETECTED)
  })

  it('reports inactive when the device is offline', () => {
    const { accessory } = build(baseDevice({ isDeviceOffline: true }))
    const leak = accessory.services.get(Service.LeakSensor)
    expect(latestValue(leak, Characteristic.StatusActive)).toBe(false)
  })

  it('updates battery level and status when a reading is present', () => {
    const { accessory } = build(baseDevice({ batteryRemaining: 10 }))
    const battery = accessory.services.get(Service.Battery)
    expect(latestValue(battery, Characteristic.BatteryLevel)).toBe(10)
    expect(latestValue(battery, Characteristic.StatusLowBattery))
      .toBe(Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW)
  })

  it('does NOT assert a battery level when no reading is present', () => {
    const { accessory } = build(baseDevice({ batteryRemaining: undefined }))
    const battery = accessory.services.get(Service.Battery)
    expect(latestValue(battery, Characteristic.BatteryLevel)).toBeUndefined()
    expect(latestValue(battery, Characteristic.StatusLowBattery)).toBeUndefined()
  })

  it('sets temperature and clears fault when a reading is present', () => {
    const device = baseDevice({ currentSensorReadings: { time: 't', temperature: 21.5, humidity: 40 } })
    const { accessory } = build(device)
    const temp = accessory.services.get(Service.TemperatureSensor)
    expect(latestValue(temp, Characteristic.CurrentTemperature)).toBe(21.5)
    expect(latestValue(temp, Characteristic.StatusFault)).toBe(Characteristic.StatusFault.NO_FAULT)
  })

  it('flags a general fault instead of showing a stale temperature when reading is missing', () => {
    const { accessory, handler } = build(baseDevice({
      currentSensorReadings: { time: 't', temperature: 21.5, humidity: 40 },
    }))
    // Simulate the reading disappearing on a later poll.
    handler.updateStatus(baseDevice({ currentSensorReadings: undefined }))
    const temp = accessory.services.get(Service.TemperatureSensor)
    expect(latestValue(temp, Characteristic.StatusFault)).toBe(Characteristic.StatusFault.GENERAL_FAULT)
  })

  it('omits the temperature service when hidden', () => {
    const { accessory } = build(baseDevice(), { deviceID: 'dev-1', hideTemperatureSensor: true })
    expect(accessory.services.get(Service.TemperatureSensor)).toBeUndefined()
  })

  it('trips the freeze contact sensor when below threshold', () => {
    const device = baseDevice({ currentSensorReadings: { time: 't', temperature: -2, humidity: 40 } })
    const { accessory } = build(device, { deviceID: 'dev-1', enableFreezeSensor: true }, 4)
    const contact = accessory.services.get(Service.ContactSensor)
    expect(latestValue(contact, Characteristic.ContactSensorState))
      .toBe(Characteristic.ContactSensorState.CONTACT_NOT_DETECTED)
  })
})
