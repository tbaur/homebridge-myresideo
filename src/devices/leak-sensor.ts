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
  activeAlarmTypes,
  clampBatteryLevel,
  hasActiveAlarms,
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
  /** Last-logged alarm summary, so an unchanged alarm set isn't re-logged each poll. */
  private lastAlarmSignature?: string

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
    // These detectors are battery-powered and cannot be charged; declaring it
    // avoids HomeKit showing a misleading "not charging/charging" default.
    this.batteryService.setCharacteristic(
      Characteristic.ChargingState,
      Characteristic.ChargingState.NOT_CHARGEABLE,
    )

    if (!options.hideTemperatureSensor) {
      this.temperatureService = this.accessory.getService(Service.TemperatureSensor)
        ?? this.accessory.addService(Service.TemperatureSensor)
      // Distinct service names so broken-out tiles aren't all the accessory name.
      this.temperatureService.setCharacteristic(Characteristic.Name, `${this.displayName} Temperature`)
    }

    if (!options.hideHumiditySensor) {
      this.humidityService = this.accessory.getService(Service.HumiditySensor)
        ?? this.accessory.addService(Service.HumiditySensor)
      this.humidityService.setCharacteristic(Characteristic.Name, `${this.displayName} Humidity`)
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

    // An unreachable device's readings are stale, and an active alarm is a
    // condition the user should see; both are surfaced as a HomeKit fault.
    const offline = !isDeviceActive(device)
    const alarmActive = hasActiveAlarms(device)
    this.logActiveAlarms(device, alarmActive)

    this.leakService.updateCharacteristic(
      Characteristic.LeakDetected,
      isLeakDetected(device)
        ? Characteristic.LeakDetected.LEAK_DETECTED
        : Characteristic.LeakDetected.LEAK_NOT_DETECTED,
    )
    this.leakService.updateCharacteristic(Characteristic.StatusActive, !offline)
    // The Leak Sensor is the primary service, so it carries the device-level
    // fault (offline or any active alarm) as a single "needs attention" signal.
    this.leakService.updateCharacteristic(
      Characteristic.StatusFault,
      offline || alarmActive
        ? Characteristic.StatusFault.GENERAL_FAULT
        : Characteristic.StatusFault.NO_FAULT,
    )

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
      this.applyReading(this.temperatureService, Characteristic.CurrentTemperature, temperature, offline)
    }

    const humidity = device.currentSensorReadings?.humidity
    if (this.humidityService) {
      this.applyReading(this.humidityService, Characteristic.CurrentRelativeHumidity, humidity, offline)
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
      // The derived freeze state is only as trustworthy as the temperature it's
      // computed from, so fault it when the reading is missing or stale.
      this.freezeService.updateCharacteristic(
        Characteristic.StatusFault,
        typeof temperature !== 'number' || offline
          ? Characteristic.StatusFault.GENERAL_FAULT
          : Characteristic.StatusFault.NO_FAULT,
      )
    }
  }

  /**
   * Emit a one-time diagnostic when the active-alarm set changes, so users can
   * see *which* condition (e.g. `HighHumidity`) drove the fault without re-logging
   * the same alarms on every poll. Alarm type strings carry no account data.
   */
  private logActiveAlarms(device: WaterLeakDetector, alarmActive: boolean): void {
    if (!alarmActive) {
      this.lastAlarmSignature = undefined
      return
    }
    const types = activeAlarmTypes(device)
    const signature = types.join(',')
    if (signature === this.lastAlarmSignature) {
      return
    }
    this.lastAlarmSignature = signature
    const summary = types.length > 0 ? types.join(', ') : 'unspecified'
    this.platform.log.warn(`${this.displayName}: active alarm(s) reported: ${summary}`)
  }

  /**
   * Update a sensor reading. Pushes the value whenever one is present (so the
   * last-known reading is still shown), and raises a general fault when the
   * reading is missing or the device is offline (and the value is therefore
   * stale) instead of presenting unreliable data as current.
   */
  private applyReading(
    service: Service,
    characteristic: Parameters<Service['updateCharacteristic']>[0],
    value: number | undefined,
    deviceOffline: boolean,
  ): void {
    const { Characteristic } = this.platform
    const hasReading = typeof value === 'number'
    if (hasReading) {
      service.updateCharacteristic(characteristic, value)
    }
    service.updateCharacteristic(
      Characteristic.StatusFault,
      !hasReading || deviceOffline
        ? Characteristic.StatusFault.GENERAL_FAULT
        : Characteristic.StatusFault.NO_FAULT,
    )
  }
}
