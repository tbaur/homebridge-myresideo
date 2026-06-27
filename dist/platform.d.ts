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
    private readonly log;
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
    constructor(log: Logging, config: ResideoPlatformConfig, api: API);
    /** Restore an accessory from the Homebridge cache. */
    configureAccessory(accessory: PlatformAccessory): void;
    private hasValidCredentials;
    private get refreshRateMs();
    private discoverDevices;
    private registerDevice;
    private optionsForDevice;
    private startPolling;
    private pollAll;
    private handleError;
    /**
     * Persist a rotated refresh token back into config.json so it survives a
     * Homebridge restart. Best-effort: failures are logged, not thrown.
     */
    private persistRefreshToken;
}
//# sourceMappingURL=platform.d.ts.map