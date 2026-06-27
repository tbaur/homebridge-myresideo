/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview HomeKit accessory for a Resideo / Honeywell Home WiFi Water
 * Leak & Freeze Detector.
 *
 * Services exposed:
 *   - Leak Sensor      (water present)
 *   - Temperature      (current temperature, optional)
 *   - Humidity         (current relative humidity, optional)
 *   - Battery          (level + low-battery status)
 *   - Contact Sensor   (optional "freeze" trigger derived from temperature;
 *                       CONTACT_NOT_DETECTED == freezing)
 */

import type { PlatformAccessory, Service } from 'homebridge'

import type { LeakDetectorOptions, WaterLeakDetector } from '../types'
import {
  clampBatteryLevel,
  isDeviceActive,
  isFreezing,
  isLeakDetected,
  isLowBattery,
  resolveFreezeThreshold,
} from '../utils'
import type ResideoPlatform from '../platform'

export class LeakSensorAccessory {
  private readonly leakService: Service
  private readonly batteryService: Service
  private readonly temperatureService?: Service
  private readonly humidityService?: Service
  private readonly freezeService?: Service

  private readonly options: LeakDetectorOptions
  private readonly defaultFreezeThreshold?: number

  constructor(
    private readonly platform: ResideoPlatform,
    private readonly accessory: PlatformAccessory,
    options: LeakDetectorOptions,
    defaultFreezeThreshold?: number,
  ) {
    this.options = options
    this.defaultFreezeThreshold = defaultFreezeThreshold
    const { Service, Characteristic } = this.platform
    const device = this.accessory.context.device as WaterLeakDetector

    this.accessory.getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'Resideo')
      .setCharacteristic(Characteristic.Model, device.deviceType || 'Water Leak Detector')
      .setCharacteristic(Characteristic.SerialNumber, device.deviceID)
      .setCharacteristic(Characteristic.FirmwareRevision, device.firmwareVer || '0.0.0')

    this.leakService = this.accessory.getService(Service.LeakSensor)
      ?? this.accessory.addService(Service.LeakSensor)

    this.batteryService = this.accessory.getService(Service.Battery)
      ?? this.accessory.addService(Service.Battery)

    if (!options.hideTemperatureSensor) {
      this.temperatureService = this.accessory.getService(Service.TemperatureSensor)
        ?? this.accessory.addService(Service.TemperatureSensor)
    }

    if (!options.hideHumiditySensor) {
      this.humidityService = this.accessory.getService(Service.HumiditySensor)
        ?? this.accessory.addService(Service.HumiditySensor)
    }

    if (options.enableFreezeSensor) {
      this.freezeService = this.accessory.getService(Service.ContactSensor)
        ?? this.accessory.addService(Service.ContactSensor)
      this.freezeService.setCharacteristic(Characteristic.Name, `${this.displayName} Freeze`)
    }

    this.updateStatus(device)
  }

  private get displayName(): string {
    return this.options.name || this.accessory.displayName
  }

  /** Push the latest device state into all HomeKit characteristics. */
  updateStatus(device: WaterLeakDetector): void {
    this.accessory.context.device = device
    const { Characteristic } = this.platform

    this.leakService.updateCharacteristic(
      Characteristic.LeakDetected,
      isLeakDetected(device)
        ? Characteristic.LeakDetected.LEAK_DETECTED
        : Characteristic.LeakDetected.LEAK_NOT_DETECTED,
    )
    this.leakService.updateCharacteristic(Characteristic.StatusActive, isDeviceActive(device))

    // Only assert a battery level when the API actually reports one; defaulting
    // a missing reading to "100% / normal" would mislead users during outages.
    const battery = clampBatteryLevel(device.batteryRemaining)
    if (battery !== undefined) {
      this.batteryService.updateCharacteristic(Characteristic.BatteryLevel, battery)
      this.batteryService.updateCharacteristic(
        Characteristic.StatusLowBattery,
        isLowBattery(device.batteryRemaining)
          ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
          : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
      )
    }

    const temperature = device.currentSensorReadings?.temperature
    if (this.temperatureService) {
      this.applyReading(this.temperatureService, Characteristic.CurrentTemperature, temperature)
    }

    const humidity = device.currentSensorReadings?.humidity
    if (this.humidityService) {
      this.applyReading(this.humidityService, Characteristic.CurrentRelativeHumidity, humidity)
    }

    if (this.freezeService) {
      const threshold = resolveFreezeThreshold(
        device,
        this.options.freezeThresholdCelsius ?? this.defaultFreezeThreshold,
      )
      const freezing = isFreezing(temperature, threshold)
      this.freezeService.updateCharacteristic(
        Characteristic.ContactSensorState,
        freezing
          ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
          : Characteristic.ContactSensorState.CONTACT_DETECTED,
      )
    }
  }

  /**
   * Update a sensor reading. When the reading is present, push the value and
   * clear any fault; when it is missing, flag the service with a general fault
   * instead of silently retaining a stale value.
   */
  private applyReading(
    service: Service,
    characteristic: Parameters<Service['updateCharacteristic']>[0],
    value: number | undefined,
  ): void {
    const { Characteristic } = this.platform
    if (typeof value === 'number') {
      service.updateCharacteristic(characteristic, value)
      service.updateCharacteristic(Characteristic.StatusFault, Characteristic.StatusFault.NO_FAULT)
    } else {
      service.updateCharacteristic(Characteristic.StatusFault, Characteristic.StatusFault.GENERAL_FAULT)
    }
  }
}
