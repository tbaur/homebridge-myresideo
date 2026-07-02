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
    /**
     * The device's `lastCheckin` timestamp at the previous observation. These
     * detectors upload to the cloud only on their configured check-in period
     * (`deviceSettings.checkinPeriod`, the app's 1–3×/day update frequency), so a
     * change here marks a genuine device report-in rather than a routine poll that
     * returned the same unchanged cloud data.
     */
    private lastCheckinAt?;
    /**
     * True until the first poll completes. The first observation establishes the
     * baseline silently because the platform logs a one-line boot state summary per
     * device; only subsequent *transitions* are logged here.
     */
    private firstObservation;
    constructor(platform: ResideoPlatform, accessory: PlatformAccessory, options: LeakDetectorOptions, defaultFreezeThreshold?: number);
    private get displayName();
    /**
     * Remove an optional service that a cached accessory still carries after the
     * user disabled it (e.g. set `hideTemperatureSensor`/`hideHumiditySensor` or
     * cleared `enableFreezeSensor`). A no-op when the service was never present.
     */
    private removeService;
    /**
     * Push the latest device state into all HomeKit characteristics. `latencyMs`
     * is the wall-clock duration of the poll request that produced this payload,
     * used only to annotate the per-check-in report; it is absent for the initial
     * constructor observation.
     */
    updateStatus(device: WaterLeakDetector, latencyMs?: number): void;
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
     * Log a one-line, named readings summary when the device's cloud check-in
     * timestamp (`lastCheckin`) advances. Because these detectors upload to the
     * cloud only on their configured check-in period (`deviceSettings.checkinPeriod`,
     * the Resideo app's 1–3×/day update frequency), most polls return unchanged
     * cloud data; keying on `lastCheckin` fires this only on a genuine fresh report,
     * so the log reflects each device update — identified by name, with its current
     * readings and the poll latency — without the noise of every poll. The first
     * observation records the baseline silently (the platform's boot summary
     * already reports startup state). A payload with no `lastCheckin` is treated as
     * "cannot tell" and stays silent rather than logging on unchanged data.
     */
    private logCheckIn;
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
     * baseline silently (for healthy *and* abnormal devices): the platform logs a
     * one-line boot state summary per device at startup, so transitions are only
     * reported here on later polls to avoid duplicating that startup report.
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