/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Type definitions for plugin config and the Resideo /
 * Honeywell Home API. API shapes are modeled directly from the published
 * documentation at https://developer.honeywellhome.com.
 */
import type { PlatformConfig } from 'homebridge';
/**
 * OAuth2 credentials and tokens. `consumerKey` / `consumerSecret` are the
 * developer-app API Key / Secret. `accessToken` / `refreshToken` are obtained
 * via the Authorization Code flow ("Link Account").
 */
export interface ResideoCredentials {
    consumerKey: string;
    consumerSecret: string;
    accessToken: string;
    refreshToken: string;
}
/** Per-detector display/visibility overrides (keyed by Honeywell deviceID). */
export interface LeakDetectorOptions {
    deviceID: string;
    /** Optional override for the accessory display name. */
    name?: string;
    hideTemperatureSensor?: boolean;
    hideHumiditySensor?: boolean;
    /** Expose a separate freeze (leak-style) sensor derived from temperature. */
    enableFreezeSensor?: boolean;
    /** Override the freeze threshold in Celsius for this device. */
    freezeThresholdCelsius?: number;
}
/**
 * The full plugin configuration block as it appears in the Homebridge
 * `config.json` platforms array.
 */
export interface ResideoPlatformConfig extends PlatformConfig {
    credentials: ResideoCredentials;
    options?: {
        /** Polling interval in seconds. */
        refreshRate?: number;
        /** Default freeze threshold in Celsius applied to all detectors. */
        freezeThresholdCelsius?: number;
        /** Per-device overrides. */
        devices?: LeakDetectorOptions[];
    };
}
/** OAuth2 token endpoint response (`/oauth2/token`). */
export interface TokenResponse {
    access_token: string;
    refresh_token: string;
    /** Lifetime of the access token in seconds (returned as a string by the API). */
    expires_in: string | number;
    token_type?: string;
}
/** A current alarm entry on a device (e.g. high temperature/humidity, offline). */
export interface DeviceAlarm {
    type: string;
    created: string;
}
/** Latest temperature/humidity readings from a water leak detector. */
export interface CurrentSensorReadings {
    time: string;
    /** Temperature in Celsius. */
    temperature: number;
    /** Relative humidity as a percentage. */
    humidity: number;
}
/** Device-configured high/low alert limits. */
export interface DeviceSettings {
    temp?: {
        high?: {
            limit: number;
        };
        low?: {
            limit: number;
        };
    };
    humidity?: {
        high?: {
            limit: number;
        };
        low?: {
            limit: number;
        };
    };
    userDefinedName?: string;
    buzzerMuted?: boolean;
    checkinPeriod?: number;
    currentSensorReadPeriod?: number;
}
/**
 * A Water Leak Detector device as returned by
 * `GET /v2/devices/waterLeakDetectors/{deviceId}` and embedded in
 * `GET /v2/locations`.
 */
export interface WaterLeakDetector {
    deviceID: string;
    deviceClass: string;
    deviceType: string;
    userDefinedDeviceName?: string;
    firmwareVer?: string;
    /** True when liquid water has been detected. */
    waterPresent: boolean;
    currentSensorReadings?: CurrentSensorReadings;
    currentAlarms?: DeviceAlarm[];
    batteryRemaining?: number;
    isRegistered?: boolean;
    hasDeviceCheckedIn?: boolean;
    isDeviceOffline?: boolean;
    isAlive?: boolean;
    wifiSignalStrength?: number;
    deviceSettings?: DeviceSettings;
}
/** A location and the devices registered to it. */
export interface ResideoLocation {
    locationID: number;
    name?: string;
    devices?: WaterLeakDetector[];
}
//# sourceMappingURL=index.d.ts.map