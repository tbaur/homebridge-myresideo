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
    /** Last-logged alarm summary, so an unchanged alarm set isn't re-logged each poll. */
    private lastAlarmSignature?;
    /** Last observed state, so transitions are logged once instead of every poll. */
    private prev?;
    constructor(platform: ResideoPlatform, accessory: PlatformAccessory, options: LeakDetectorOptions, defaultFreezeThreshold?: number);
    private get displayName();
    /** Push the latest device state into all HomeKit characteristics. */
    updateStatus(device: WaterLeakDetector): void;
    /**
     * Update the Battery service. Only asserts a level when the API reports one;
     * defaulting a missing reading to "100% / normal" would mislead during outages.
     */
    private updateBattery;
    /**
     * Update the optional freeze Contact Sensor and report the freeze state used
     * for logging. The state is only "known" (not `undefined`) when the sensor is
     * enabled and a real temperature reading backs it.
     */
    private updateFreezeService;
    /**
     * Emit a one-time diagnostic when the active-alarm set changes, so users can
     * see *which* condition (e.g. `HighHumidity`) drove the fault without re-logging
     * the same alarms on every poll. Alarm type strings carry no account data.
     */
    private logActiveAlarms;
    /**
     * Log human-meaningful state transitions once when they flip (so the log
     * reflects what changed each poll, not the unchanging baseline), and emit a
     * full per-poll snapshot at debug level. The first poll establishes the
     * baseline silently for a healthy device, but surfaces an already-abnormal
     * state (leak/offline/low battery/freezing) so startup problems are visible.
     */
    private logObservedState;
    /**
     * Update a sensor reading. Pushes the value whenever one is present (so the
     * last-known reading is still shown), and raises a general fault when the
     * reading is missing or the device is offline (and the value is therefore
     * stale) instead of presenting unreliable data as current.
     */
    private applyReading;
}
//# sourceMappingURL=leak-sensor.d.ts.map