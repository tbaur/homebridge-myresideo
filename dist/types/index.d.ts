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
 * Minimal logger surface shared by the API/auth layers. Any subset of methods
 * may be provided; the Homebridge `Logging` object satisfies it.
 */
export interface PluginLogger {
    debug?: (message: string) => void;
    warn?: (message: string) => void;
    error?: (message: string) => void;
}
/**
 * OAuth2 credentials and tokens. `consumerKey` / `consumerSecret` are the
 * developer-app API Key / Secret. `accessToken` / `refreshToken` are obtained
 * via the Authorization Code flow ("Link Account").
 */
export interface ResideoCredentials {
    consumerKey: string;
    consumerSecret: string;
    /**
     * Optional starting access token. Its true expiry is unknown to the plugin,
     * so it is used optimistically once and then refreshed from `refreshToken`.
     */
    accessToken?: string;
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
        /**
         * Health-report cadence in seconds. Emits a periodic diagnostics line to
         * the log every N seconds; `0` (the default) disables the subsystem.
         */
        diagnosticsInterval?: number;
        /** Emit diagnostics as machine-readable JSON in addition to the human line. */
        structuredLogs?: boolean;
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
/**
 * A current alarm entry on a device. The shape (`type` + `created`) is taken
 * from the published Honeywell Home Water Leak Detector documentation; observed
 * `type` values include `HighTemperature`, `HighHumidity`, and `DeviceOffline`.
 * Healthy devices report an empty `currentAlarms` array. Both fields are kept
 * optional (and the index signature retained) so a malformed entry can never
 * throw — `hasActiveAlarms`/`activeAlarmTypes` consume them defensively.
 */
export interface DeviceAlarm {
    type?: string;
    created?: string;
    [key: string]: unknown;
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
 *
 * Verified against a real WLD3 payload (firmware 0.6.8A4/A5): the single-device
 * endpoint returns the same shape as the embedded location view. Only the fields
 * the plugin consumes are required; the rest are optional and documented for
 * reference. Unlisted API fields are ignored.
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
    /** ISO timestamp of the device's last cloud check-in. */
    lastCheckin?: string;
    /** Numeric internal device identifier (distinct from the UUID `deviceID`). */
    deviceInternalID?: number;
    /** Hardware MAC address. */
    macID?: string;
    /** Hardware variant, e.g. "WLD3". */
    deviceVariant?: string;
    isUpgrading?: boolean;
    isProvisioned?: boolean;
    /** ISO timestamp after which the device is considered offline. */
    deviceOfflineTime?: string;
}
/** A location and the devices registered to it. */
export interface ResideoLocation {
    locationID: number;
    name?: string;
    devices?: WaterLeakDetector[];
}
/**
 * Absolute device gauges computed by the platform from its current accessories.
 * Unlike myleviton (controllable lights/fans), Resideo detectors are read-only
 * sensors, so the meaningful gauges are reachability and active conditions.
 */
export interface DeviceGauges {
    /** Detectors returned by Resideo at last discovery. */
    cloud: number;
    /** Detectors currently exposed to HomeKit. */
    total: number;
    /** Detectors reporting as reachable/online. */
    online: number;
    /** Detectors currently reporting water present. */
    leak: number;
    /** Detectors currently reporting a low battery. */
    lowBattery: number;
}
/**
 * One opt-in diagnostics report. Because the plugin is polling-only and exposes
 * read-only sensors, this is a reduced version of myleviton's snapshot: there is
 * no WebSocket, circuit breaker, rate limiter, or cache to report on.
 */
export interface DiagnosticsSnapshot {
    /** Channel identifier, e.g. `health`, `diagnostics.start`, `diagnostics.stop`. */
    msg: string;
    lifecycle: {
        health: 'healthy' | 'degraded';
        reasons: string[];
        uptimeSec: number;
        pluginVersion: string;
    };
    devices: DeviceGauges;
    polling: {
        cadenceSec: number;
        lastDurationMs: number | null;
        ok: number;
        failed: number;
    };
    token: {
        expiresInSec: number | null;
        lastRefreshAt: number | null;
        refreshes: number;
    };
    api: {
        p50Ms: number;
        p95Ms: number;
        requests: number;
        errors: number;
    };
    activity: {
        /** API request retries (transient failures + the 401 refresh-and-retry). */
        retries: number;
        /** Device state transitions observed across polls (leak/offline/battery/freeze). */
        stateChanges: number;
    };
    /** Redacted config echo, present only on boot/shutdown snapshots. */
    config?: Record<string, unknown>;
}
//# sourceMappingURL=index.d.ts.map