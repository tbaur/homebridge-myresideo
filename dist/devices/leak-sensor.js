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
    /** Last-logged alarm summary, so an unchanged alarm set isn't re-logged each poll. */
    lastAlarmSignature;
    /** Last observed state, so transitions are logged once instead of every poll. */
    prev;
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
        // These detectors are battery-powered and cannot be charged; declaring it
        // avoids HomeKit showing a misleading "not charging/charging" default.
        this.batteryService.setCharacteristic(Characteristic.ChargingState, Characteristic.ChargingState.NOT_CHARGEABLE);
        if (!options.hideTemperatureSensor) {
            this.temperatureService = this.accessory.getService(Service.TemperatureSensor)
                ?? this.accessory.addService(Service.TemperatureSensor);
            // Distinct service names so broken-out tiles aren't all the accessory name.
            this.temperatureService.setCharacteristic(Characteristic.Name, `${this.displayName} Temperature`);
        }
        else {
            // The option was toggled off after the service had already been added to a
            // cached accessory; drop the now-orphaned service so it leaves HomeKit too.
            this.removeService(this.accessory.getService(Service.TemperatureSensor));
        }
        if (!options.hideHumiditySensor) {
            this.humidityService = this.accessory.getService(Service.HumiditySensor)
                ?? this.accessory.addService(Service.HumiditySensor);
            this.humidityService.setCharacteristic(Characteristic.Name, `${this.displayName} Humidity`);
        }
        else {
            this.removeService(this.accessory.getService(Service.HumiditySensor));
        }
        if (options.enableFreezeSensor) {
            this.freezeService = this.accessory.getService(Service.ContactSensor)
                ?? this.accessory.addService(Service.ContactSensor);
            this.freezeService.setCharacteristic(Characteristic.Name, `${this.displayName} Freeze`);
        }
        else {
            this.removeService(this.accessory.getService(Service.ContactSensor));
        }
        this.updateStatus(device);
    }
    get displayName() {
        return this.options.name || this.accessory.displayName;
    }
    /**
     * Remove an optional service that a cached accessory still carries after the
     * user disabled it (e.g. set `hideTemperatureSensor`/`hideHumiditySensor` or
     * cleared `enableFreezeSensor`). A no-op when the service was never present.
     */
    removeService(service) {
        if (service) {
            this.accessory.removeService(service);
        }
    }
    /** Push the latest device state into all HomeKit characteristics. */
    updateStatus(device) {
        this.accessory.context.device = device;
        const { Characteristic } = this.platform;
        // An unreachable device's readings are stale, and an active alarm is a
        // condition the user should see; both are surfaced as a HomeKit fault.
        const offline = !(0, utils_1.isDeviceActive)(device);
        const leak = (0, utils_1.isLeakDetected)(device);
        const alarmActive = (0, utils_1.hasActiveAlarms)(device);
        this.leakService.updateCharacteristic(Characteristic.LeakDetected, leak
            ? Characteristic.LeakDetected.LEAK_DETECTED
            : Characteristic.LeakDetected.LEAK_NOT_DETECTED);
        this.leakService.updateCharacteristic(Characteristic.StatusActive, !offline);
        // The Leak Sensor is the primary service, so it carries the device-level
        // fault (offline or any active alarm) as a single "needs attention" signal.
        this.leakService.updateCharacteristic(Characteristic.StatusFault, offline || alarmActive
            ? Characteristic.StatusFault.GENERAL_FAULT
            : Characteristic.StatusFault.NO_FAULT);
        const battery = (0, utils_1.clampBatteryLevel)(device.batteryRemaining);
        this.updateBattery(device, battery);
        const temperature = device.currentSensorReadings?.temperature;
        if (this.temperatureService) {
            this.applyReading(this.temperatureService, Characteristic.CurrentTemperature, temperature, offline);
        }
        const humidity = device.currentSensorReadings?.humidity;
        if (this.humidityService) {
            this.applyReading(this.humidityService, Characteristic.CurrentRelativeHumidity, humidity, offline);
        }
        const freeze = this.updateFreezeService(device, temperature, offline);
        this.logActiveAlarms(device, alarmActive);
        this.logObservedState({
            leak,
            online: !offline,
            lowBattery: battery === undefined ? undefined : (0, utils_1.isLowBattery)(device.batteryRemaining),
            batteryLevel: battery,
            freezing: freeze.freezing,
            temperature,
            freezeThreshold: freeze.threshold,
            humidity,
        });
    }
    /**
     * Update the Battery service. Only asserts a level when the API reports one;
     * defaulting a missing reading to "100% / normal" would mislead during outages.
     */
    updateBattery(device, battery) {
        if (battery === undefined) {
            return;
        }
        const { Characteristic } = this.platform;
        this.batteryService.updateCharacteristic(Characteristic.BatteryLevel, battery);
        this.batteryService.updateCharacteristic(Characteristic.StatusLowBattery, (0, utils_1.isLowBattery)(device.batteryRemaining)
            ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
            : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
    }
    /**
     * Update the optional freeze Contact Sensor and report the freeze state used
     * for logging. The state is only "known" (not `undefined`) when the sensor is
     * enabled and a real temperature reading backs it.
     */
    updateFreezeService(device, temperature, offline) {
        if (!this.freezeService) {
            return {};
        }
        const { Characteristic } = this.platform;
        const threshold = (0, utils_1.resolveFreezeThreshold)(device, this.options.freezeThresholdCelsius ?? this.defaultFreezeThreshold);
        const freezing = (0, utils_1.isFreezing)(temperature, threshold);
        this.freezeService.updateCharacteristic(Characteristic.ContactSensorState, freezing
            ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
            : Characteristic.ContactSensorState.CONTACT_DETECTED);
        // The derived freeze state is only as trustworthy as the temperature it's
        // computed from, so fault it when the reading is missing or stale.
        this.freezeService.updateCharacteristic(Characteristic.StatusFault, typeof temperature !== 'number' || offline
            ? Characteristic.StatusFault.GENERAL_FAULT
            : Characteristic.StatusFault.NO_FAULT);
        return { freezing: typeof temperature === 'number' ? freezing : undefined, threshold };
    }
    /**
     * Emit a one-time diagnostic when the active-alarm set changes, so users can
     * see *which* condition (e.g. `HighHumidity`) drove the fault without re-logging
     * the same alarms on every poll. Alarm type strings carry no account data.
     */
    logActiveAlarms(device, alarmActive) {
        if (!alarmActive) {
            if (this.lastAlarmSignature !== undefined) {
                this.platform.log.info(`${this.displayName}: alarms cleared`);
            }
            this.lastAlarmSignature = undefined;
            return;
        }
        const types = (0, utils_1.activeAlarmTypes)(device);
        const signature = types.join(',');
        if (signature === this.lastAlarmSignature) {
            return;
        }
        this.lastAlarmSignature = signature;
        const summary = types.length > 0 ? types.join(', ') : 'unspecified';
        this.platform.log.warn(`${this.displayName}: active alarm(s) reported: ${summary}`);
    }
    /**
     * Log human-meaningful state transitions once when they flip (so the log
     * reflects what changed each poll, not the unchanging baseline), and emit a
     * full per-poll snapshot at debug level. The first poll establishes the
     * baseline silently for a healthy device, but surfaces an already-abnormal
     * state (leak/offline/low battery/freezing) so startup problems are visible.
     */
    logObservedState(state) {
        const prev = this.prev;
        const name = this.displayName;
        const { log } = this.platform;
        if (state.leak && !prev?.leak) {
            log.warn(`${name}: LEAK DETECTED`);
        }
        else if (!state.leak && prev?.leak) {
            log.info(`${name}: leak cleared`);
        }
        if (!state.online && (prev === undefined || prev.online)) {
            log.info(`${name}: went offline`);
        }
        else if (state.online && prev !== undefined && !prev.online) {
            log.info(`${name}: back online`);
        }
        if (state.lowBattery !== undefined) {
            if (state.lowBattery && !prev?.lowBattery) {
                log.info(`${name}: low battery (${state.batteryLevel}%)`);
            }
            else if (!state.lowBattery && prev?.lowBattery) {
                log.info(`${name}: battery recovered (${state.batteryLevel}%)`);
            }
        }
        if (state.freezing !== undefined) {
            if (state.freezing && !prev?.freezing) {
                log.info(`${name}: freezing (${state.temperature}°C ≤ ${state.freezeThreshold}°C)`);
            }
            else if (!state.freezing && prev?.freezing) {
                log.info(`${name}: above freeze threshold (${state.temperature}°C)`);
            }
        }
        // Count a diagnostics state change only after a baseline exists, so the
        // first poll establishing initial state is not itself reported as a change.
        if (prev !== undefined && (state.leak !== prev.leak
            || state.online !== prev.online
            || state.lowBattery !== prev.lowBattery
            || state.freezing !== prev.freezing)) {
            this.platform.recordStateChange();
        }
        this.prev = {
            leak: state.leak,
            online: state.online,
            lowBattery: state.lowBattery,
            freezing: state.freezing,
        };
        const fmt = (value, unit) => typeof value === 'number' ? `${value}${unit}` : 'n/a';
        log.debug(`${name}: poll ok — leak=${state.leak}, temp=${fmt(state.temperature, '°C')}, `
            + `humidity=${fmt(state.humidity, '%')}, battery=${fmt(state.batteryLevel, '%')}, online=${state.online}`);
    }
    /**
     * Update a sensor reading. Pushes the value whenever one is present (so the
     * last-known reading is still shown), and raises a general fault when the
     * reading is missing or the device is offline (and the value is therefore
     * stale) instead of presenting unreliable data as current.
     */
    applyReading(service, characteristic, value, deviceOffline) {
        const { Characteristic } = this.platform;
        const hasReading = typeof value === 'number';
        if (hasReading) {
            service.updateCharacteristic(characteristic, value);
        }
        service.updateCharacteristic(Characteristic.StatusFault, !hasReading || deviceOffline
            ? Characteristic.StatusFault.GENERAL_FAULT
            : Characteristic.StatusFault.NO_FAULT);
    }
}
exports.LeakSensorAccessory = LeakSensorAccessory;
//# sourceMappingURL=leak-sensor.js.map