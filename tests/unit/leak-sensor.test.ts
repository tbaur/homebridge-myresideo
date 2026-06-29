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
  ChargingState: mkChar('ChargingState', { NOT_CHARGEABLE: 2, NOT_CHARGING: 0, CHARGING: 1 }),
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
    removeService: jest.fn((svc: MockService) => {
      services.delete(svc.type)
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

function makeLog() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}

function build(device: WaterLeakDetector, options: LeakDetectorOptions = { deviceID: 'dev-1' }, threshold?: number) {
  const accessory = makeAccessory(device)
  const log = makeLog()
  const recordStateChange = jest.fn()
  const platform = { Service, Characteristic, log, recordStateChange } as unknown as ResideoPlatform
  const handler = new LeakSensorAccessory(
    platform,
    accessory as unknown as PlatformAccessory,
    options,
    threshold,
  )
  return { handler, accessory, log, recordStateChange }
}

describe('LeakSensorAccessory', () => {
  it('reflects leak-detected state', () => {
    const { accessory } = build(baseDevice({ waterPresent: true }))
    const leak = accessory.services.get(Service.LeakSensor)
    expect(latestValue(leak, Characteristic.LeakDetected)).toBe(Characteristic.LeakDetected.LEAK_DETECTED)
  })

  it('reports inactive and faults the leak service when the device is offline', () => {
    const { accessory } = build(baseDevice({ isDeviceOffline: true }))
    const leak = accessory.services.get(Service.LeakSensor)
    expect(latestValue(leak, Characteristic.StatusActive)).toBe(false)
    expect(latestValue(leak, Characteristic.StatusFault)).toBe(Characteristic.StatusFault.GENERAL_FAULT)
  })

  it('faults the leak service on an active alarm while still reporting active', () => {
    const { accessory, log } = build(baseDevice({
      currentAlarms: [{ type: 'HighHumidity', created: '2026-01-01T00:00:00' }],
    }))
    const leak = accessory.services.get(Service.LeakSensor)
    expect(latestValue(leak, Characteristic.StatusActive)).toBe(true)
    expect(latestValue(leak, Characteristic.StatusFault)).toBe(Characteristic.StatusFault.GENERAL_FAULT)
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('HighHumidity'))
  })

  it('clears the leak-service fault and logs once across unchanged polls', () => {
    const { accessory, handler, log } = build(baseDevice())
    const leak = accessory.services.get(Service.LeakSensor)
    expect(latestValue(leak, Characteristic.StatusFault)).toBe(Characteristic.StatusFault.NO_FAULT)

    const alarmed = baseDevice({ currentAlarms: [{ type: 'HighTemperature' }] })
    handler.updateStatus(alarmed)
    handler.updateStatus(alarmed)
    expect(log.warn).toHaveBeenCalledTimes(1) // unchanged alarm set is not re-logged

    handler.updateStatus(baseDevice())
    expect(latestValue(leak, Characteristic.StatusFault)).toBe(Characteristic.StatusFault.NO_FAULT)
  })

  it('faults the temperature service when offline even though a (stale) reading exists', () => {
    const device = baseDevice({
      isDeviceOffline: true,
      currentSensorReadings: { time: 't', temperature: 18, humidity: 60 },
    })
    const { accessory } = build(device)
    const temp = accessory.services.get(Service.TemperatureSensor)
    expect(latestValue(temp, Characteristic.CurrentTemperature)).toBe(18) // last-known value still shown
    expect(latestValue(temp, Characteristic.StatusFault)).toBe(Characteristic.StatusFault.GENERAL_FAULT)
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

  it('removes a previously-added optional service when it is later disabled', () => {
    // Simulate a cached accessory that already carries the optional services
    // from a prior config (temperature/humidity visible, freeze enabled).
    const accessory = makeAccessory(baseDevice())
    accessory.addService(Service.TemperatureSensor)
    accessory.addService(Service.HumiditySensor)
    accessory.addService(Service.ContactSensor)
    const platform = { Service, Characteristic, log: makeLog(), recordStateChange: jest.fn() } as unknown as ResideoPlatform

    // Re-create the handler with all three optional services turned off.
    new LeakSensorAccessory(
      platform,
      accessory as unknown as PlatformAccessory,
      { deviceID: 'dev-1', hideTemperatureSensor: true, hideHumiditySensor: true, enableFreezeSensor: false },
    )

    expect(accessory.services.get(Service.TemperatureSensor)).toBeUndefined()
    expect(accessory.services.get(Service.HumiditySensor)).toBeUndefined()
    expect(accessory.services.get(Service.ContactSensor)).toBeUndefined()
  })

  it('trips the freeze contact sensor when below threshold', () => {
    const device = baseDevice({ currentSensorReadings: { time: 't', temperature: -2, humidity: 40 } })
    const { accessory } = build(device, { deviceID: 'dev-1', enableFreezeSensor: true }, 4)
    const contact = accessory.services.get(Service.ContactSensor)
    expect(latestValue(contact, Characteristic.ContactSensorState))
      .toBe(Characteristic.ContactSensorState.CONTACT_NOT_DETECTED)
    expect(latestValue(contact, Characteristic.StatusFault)).toBe(Characteristic.StatusFault.NO_FAULT)
  })

  it('faults the freeze contact sensor when the temperature reading is missing', () => {
    const { accessory } = build(baseDevice(), { deviceID: 'dev-1', enableFreezeSensor: true }, 4)
    const contact = accessory.services.get(Service.ContactSensor)
    expect(latestValue(contact, Characteristic.StatusFault)).toBe(Characteristic.StatusFault.GENERAL_FAULT)
  })
})

describe('LeakSensorAccessory state-transition logging', () => {
  const healthy = () => baseDevice({
    batteryRemaining: 90,
    currentSensorReadings: { time: 't', temperature: 20, humidity: 50 },
  })

  it('stays silent on a healthy initial poll but emits a debug snapshot', () => {
    const { log } = build(healthy())
    expect(log.warn).not.toHaveBeenCalled()
    expect(log.info).not.toHaveBeenCalled()
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('poll ok'))
  })

  it('surfaces an already-abnormal state on the first poll', () => {
    const { log } = build(baseDevice({ waterPresent: true }))
    expect(log.warn).toHaveBeenCalledWith('Test Detector: LEAK DETECTED')
  })

  it('logs leak detected (warn) and cleared (info) on transitions only', () => {
    const { handler, log } = build(healthy())
    handler.updateStatus(healthy()) // unchanged → no transition log
    expect(log.warn).not.toHaveBeenCalled()

    handler.updateStatus(baseDevice({ waterPresent: true, batteryRemaining: 90 }))
    expect(log.warn).toHaveBeenCalledWith('Test Detector: LEAK DETECTED')
    expect(log.warn).toHaveBeenCalledTimes(1)

    handler.updateStatus(healthy())
    expect(log.info).toHaveBeenCalledWith('Test Detector: leak cleared')
  })

  it('logs connectivity transitions', () => {
    const { handler, log } = build(healthy())
    handler.updateStatus(baseDevice({ isDeviceOffline: true, batteryRemaining: 90 }))
    expect(log.info).toHaveBeenCalledWith('Test Detector: went offline')
    handler.updateStatus(healthy())
    expect(log.info).toHaveBeenCalledWith('Test Detector: back online')
  })

  it('logs low-battery and recovery transitions with the level', () => {
    const { handler, log } = build(healthy())
    handler.updateStatus(baseDevice({ batteryRemaining: 10 }))
    expect(log.info).toHaveBeenCalledWith('Test Detector: low battery (10%)')
    handler.updateStatus(baseDevice({ batteryRemaining: 80 }))
    expect(log.info).toHaveBeenCalledWith('Test Detector: battery recovered (80%)')
  })

  it('logs freeze transitions when the freeze sensor is enabled', () => {
    const warm = baseDevice({ currentSensorReadings: { time: 't', temperature: 20, humidity: 40 } })
    const { handler, log } = build(warm, { deviceID: 'dev-1', enableFreezeSensor: true }, 4)
    handler.updateStatus(baseDevice({ currentSensorReadings: { time: 't', temperature: 1, humidity: 40 } }))
    expect(log.info).toHaveBeenCalledWith('Test Detector: freezing (1°C ≤ 4°C)')
    handler.updateStatus(baseDevice({ currentSensorReadings: { time: 't', temperature: 10, humidity: 40 } }))
    expect(log.info).toHaveBeenCalledWith('Test Detector: above freeze threshold (10°C)')
  })

  it('logs when alarms clear', () => {
    const { handler, log } = build(healthy())
    handler.updateStatus(baseDevice({ currentAlarms: [{ type: 'HighHumidity' }], batteryRemaining: 90 }))
    handler.updateStatus(healthy())
    expect(log.info).toHaveBeenCalledWith('Test Detector: alarms cleared')
  })

  it('records a diagnostics state change only on a real transition, not the baseline', () => {
    const { handler, recordStateChange } = build(healthy())
    // First poll established the baseline; an unchanged poll is not a change.
    handler.updateStatus(healthy())
    expect(recordStateChange).not.toHaveBeenCalled()

    handler.updateStatus(baseDevice({ waterPresent: true, batteryRemaining: 90 }))
    expect(recordStateChange).toHaveBeenCalledTimes(1)
  })
})
