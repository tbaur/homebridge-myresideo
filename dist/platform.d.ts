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
    private tokenManager?;
    private client?;
    private pollTimer?;
    private discoveryTimer?;
    private discoveryAttempt;
    private isPolling;
    private stopped;
    /** True when startup validation failed; the platform stays inert. */
    private disabled;
    constructor(log: Logging, config: ResideoPlatformConfig, api: API);
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
    /** Poll every device with bounded concurrency so cycle time stays bounded. */
    private pollAll;
    private handleError;
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