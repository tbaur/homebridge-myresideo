"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.LeakSensorAccessory = void 0;
const utils_1 = require("../utils");
class LeakSensorAccessory {
    platform;
    accessory;
    leakService;
    batteryService;
    temperatureService;
    humidityService;
    freezeService;
    options;
    defaultFreezeThreshold;
    constructor(platform, accessory, options, defaultFreezeThreshold) {
        this.platform = platform;
        this.accessory = accessory;
        this.options = options;
        this.defaultFreezeThreshold = defaultFreezeThreshold;
        const { Service, Characteristic } = this.platform;
        const device = this.accessory.context.device;
        this.accessory.getService(Service.AccessoryInformation)
            .setCharacteristic(Characteristic.Manufacturer, 'Resideo')
            .setCharacteristic(Characteristic.Model, device.deviceType || 'Water Leak Detector')
            .setCharacteristic(Characteristic.SerialNumber, device.deviceID)
            .setCharacteristic(Characteristic.FirmwareRevision, device.firmwareVer || '0.0.0');
        this.leakService = this.accessory.getService(Service.LeakSensor)
            ?? this.accessory.addService(Service.LeakSensor);
        this.batteryService = this.accessory.getService(Service.Battery)
            ?? this.accessory.addService(Service.Battery);
        if (!options.hideTemperatureSensor) {
            this.temperatureService = this.accessory.getService(Service.TemperatureSensor)
                ?? this.accessory.addService(Service.TemperatureSensor);
        }
        if (!options.hideHumiditySensor) {
            this.humidityService = this.accessory.getService(Service.HumiditySensor)
                ?? this.accessory.addService(Service.HumiditySensor);
        }
        if (options.enableFreezeSensor) {
            this.freezeService = this.accessory.getService(Service.ContactSensor)
                ?? this.accessory.addService(Service.ContactSensor);
            this.freezeService.setCharacteristic(Characteristic.Name, `${this.displayName} Freeze`);
        }
        this.updateStatus(device);
    }
    get displayName() {
        return this.options.name || this.accessory.displayName;
    }
    /** Push the latest device state into all HomeKit characteristics. */
    updateStatus(device) {
        this.accessory.context.device = device;
        const { Characteristic } = this.platform;
        this.leakService.updateCharacteristic(Characteristic.LeakDetected, (0, utils_1.isLeakDetected)(device)
            ? Characteristic.LeakDetected.LEAK_DETECTED
            : Characteristic.LeakDetected.LEAK_NOT_DETECTED);
        this.leakService.updateCharacteristic(Characteristic.StatusActive, device.hasDeviceCheckedIn !== false);
        const battery = (0, utils_1.clampBatteryLevel)(device.batteryRemaining);
        this.batteryService.updateCharacteristic(Characteristic.BatteryLevel, battery);
        this.batteryService.updateCharacteristic(Characteristic.StatusLowBattery, (0, utils_1.isLowBattery)(device.batteryRemaining)
            ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
            : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
        const temperature = device.currentSensorReadings?.temperature;
        if (this.temperatureService && typeof temperature === 'number') {
            this.temperatureService.updateCharacteristic(Characteristic.CurrentTemperature, temperature);
        }
        const humidity = device.currentSensorReadings?.humidity;
        if (this.humidityService && typeof humidity === 'number') {
            this.humidityService.updateCharacteristic(Characteristic.CurrentRelativeHumidity, humidity);
        }
        if (this.freezeService) {
            const threshold = (0, utils_1.resolveFreezeThreshold)(device, this.options.freezeThresholdCelsius ?? this.defaultFreezeThreshold);
            const freezing = (0, utils_1.isFreezing)(temperature, threshold);
            this.freezeService.updateCharacteristic(Characteristic.ContactSensorState, freezing
                ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
                : Characteristic.ContactSensorState.CONTACT_DETECTED);
        }
    }
}
exports.LeakSensorAccessory = LeakSensorAccessory;
//# sourceMappingURL=leak-sensor.js.map