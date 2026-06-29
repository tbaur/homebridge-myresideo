/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Homebridge dynamic platform for Resideo / Honeywell Home
 * WiFi Water Leak & Freeze Detectors.
 */
import type { API, Characteristic as CharacteristicClass, DynamicPlatformPlugin, Logging, PlatformAccessory, Service as ServiceClass } from 'homebridge';
import type { ResideoPlatformConfig } from './types';
export default class ResideoPlatform implements DynamicPlatformPlugin {
    readonly log: Logging;
    private readonly api;
    readonly Service: typeof ServiceClass;
    readonly Characteristic: typeof CharacteristicClass;
    readonly accessories: PlatformAccessory[];
    private readonly config;
    private readonly handlers;
    private readonly locationByDevice;
    /** Device IDs whose one-line boot state summary has already been logged, so a
     *  discovery retry that re-registers the same detectors does not re-log it. */
    private readonly bootSummaryLogged;
    private tokenManager?;
    private client?;
    private pollTimer?;
    private discoveryTimer?;
    private discoveryAttempt;
    private isPolling;
    private stopped;
    /** True when startup validation failed; the platform stays inert. */
    private disabled;
    private diagnostics?;
    private diagnosticsTimer?;
    private lastDiagnosticsHealth;
    /** Detectors returned by Resideo at the last successful discovery. */
    private lastCloudDetectorCount;
    /** Epoch ms of the last failed token refresh, for the degraded-health window. */
    private lastRefreshFailureAt;
    constructor(log: Logging, config: ResideoPlatformConfig, api: API);
    /**
     * Record a device state transition (leak/offline/battery/freeze) for the
     * diagnostics activity counter. Called by the accessory handlers. The collector
     * accumulates counters whenever the platform is active (regardless of
     * `diagnosticsInterval`); only emission to the log is gated on the interval, so
     * this is a no-op only when the platform was disabled by invalid config.
     */
    recordStateChange(): void;
    /** Restore an accessory from the Homebridge cache. */
    configureAccessory(accessory: PlatformAccessory): void;
    private get refreshRateMs();
    private discoverDevices;
    /**
     * Errors that retrying discovery cannot resolve, so we stop instead of
     * looping the capped backoff forever and spamming the log. This covers bad
     * credentials/re-link conditions ({@link AuthenticationError} and its
     * {@link RefreshTokenInvalidError} subclass, {@link ConfigurationError}), a
     * permissions problem ({@link ForbiddenError}), an unparseable/unexpected
     * payload ({@link ApiParseError}), and any non-retryable HTTP response such
     * as a 404 ({@link ApiResponseError} with `isRetryable === false`). Transient
     * 5xx/network/timeout errors remain retryable.
     */
    private isFatal;
    /**
     * Retry discovery with capped exponential backoff so a transient outage at
     * boot doesn't leave the plugin permanently inert until a manual restart.
     */
    private scheduleDiscoveryRetry;
    private registerDevice;
    /** Unregister cached accessories that are no longer present in the account. */
    private pruneStaleAccessories;
    private optionsForDevice;
    private startPolling;
    /** Run one poll cycle, skipping if a previous cycle is still in flight. */
    private runPollCycle;
    /**
     * Poll every device with bounded concurrency so cycle time stays bounded.
     * Returns per-cycle success/failure counts for diagnostics.
     */
    private pollAll;
    private handleError;
    /** Diagnostics heartbeat interval in milliseconds (0 when disabled). */
    private diagnosticsIntervalMs;
    /** Effective polling cadence in seconds (mirrors refreshRateMs clamping). */
    private pollingCadenceSeconds;
    /**
     * Start the diagnostics subsystem: emit the boot snapshot and schedule the
     * heartbeat. No-op unless options.diagnosticsInterval > 0. Diagnostics must
     * never be able to crash the host, so emission is wrapped defensively.
     */
    private startDiagnostics;
    /** Emit the cumulative stop snapshot and tear down the heartbeat timer. */
    private stopDiagnostics;
    /**
     * Emit a single heartbeat (per-interval deltas) and log health transitions.
     * Wrapped so a reader failure can never escape the timer and crash Homebridge.
     */
    private diagnosticsHeartbeat;
    /**
     * Build the synchronous, in-memory readers the collector uses. Never performs
     * network I/O.
     */
    private buildDiagnosticsReaders;
    /**
     * Compute absolute device gauges from the latest polled state stored on each
     * accessory's context. Reachability and active conditions are the meaningful
     * signals for these read-only sensors.
     */
    private collectDeviceGauges;
    /**
     * Emit a diagnostics report as a human-readable line, plus a structured JSON
     * line when options.structuredLogs is enabled. The report is already redacted.
     */
    private emitDiagnostic;
    /**
     * Persist a rotated refresh token back into config.json so it survives a
     * Homebridge restart. Writes atomically (temp file + rename) so a crash
     * mid-write cannot corrupt config. A failure here is serious — the rotated
     * token is only in memory, so the next restart will read the now-invalidated
     * old token and require re-linking — so it is logged at error level with that
     * consequence spelled out, but never thrown (rotation already succeeded).
     */
    private persistRefreshToken;
    /**
     * Choose which platform block to write the rotated token into. With a single
     * block the choice is unambiguous; with several, only a unique name match is
     * safe. Refuse to guess when multiple blocks share this instance's name,
     * rather than risk writing the token into the wrong instance's credentials.
     */
    private selectConfigBlock;
}
//# sourceMappingURL=platform.d.ts.map