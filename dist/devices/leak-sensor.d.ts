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
import type { PlatformAccessory } from 'homebridge';
import type { LeakDetectorOptions, WaterLeakDetector } from '../types';
import type ResideoPlatform from '../platform';
export declare class LeakSensorAccessory {
    private readonly platform;
    private readonly accessory;
    private readonly leakService;
    private readonly batteryService;
    private readonly temperatureService?;
    private readonly humidityService?;
    private readonly freezeService?;
    private readonly options;
    private readonly defaultFreezeThreshold?;
    constructor(platform: ResideoPlatform, accessory: PlatformAccessory, options: LeakDetectorOptions, defaultFreezeThreshold?: number);
    private get displayName();
    /** Push the latest device state into all HomeKit characteristics. */
    updateStatus(device: WaterLeakDetector): void;
    /**
     * Update a sensor reading. When the reading is present, push the value and
     * clear any fault; when it is missing, flag the service with a general fault
     * instead of silently retaining a stale value.
     */
    private applyReading;
}
//# sourceMappingURL=leak-sensor.d.ts.map