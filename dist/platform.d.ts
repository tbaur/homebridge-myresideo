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
    constructor(log: Logging, config: ResideoPlatformConfig, api: API);
    /** Restore an accessory from the Homebridge cache. */
    configureAccessory(accessory: PlatformAccessory): void;
    private get refreshRateMs();
    private discoverDevices;
    /** Errors that re-linking or fixing credentials can't be retried away from. */
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
     * Homebridge restart. Best-effort: failures are logged, not thrown. Writes
     * atomically (temp file + rename) so a crash mid-write cannot corrupt config.
     */
    private persistRefreshToken;
}
//# sourceMappingURL=platform.d.ts.map