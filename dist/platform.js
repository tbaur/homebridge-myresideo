"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Homebridge dynamic platform for Resideo / Honeywell Home
 * WiFi Water Leak & Freeze Detectors.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = require("node:fs");
const api_1 = require("./api");
const leak_sensor_1 = require("./devices/leak-sensor");
const errors_1 = require("./errors");
const settings_1 = require("./settings");
const utils_1 = require("./utils");
class ResideoPlatform {
    log;
    api;
    Service;
    Characteristic;
    accessories = [];
    config;
    handlers = new Map();
    locationByDevice = new Map();
    tokenManager;
    client;
    pollTimer;
    discoveryTimer;
    discoveryAttempt = 0;
    isPolling = false;
    stopped = false;
    constructor(log, config, api) {
        this.log = log;
        this.api = api;
        this.Service = api.hap.Service;
        this.Characteristic = api.hap.Characteristic;
        this.config = config;
        const { errors, warnings } = (0, utils_1.validateConfig)(config);
        for (const warning of warnings) {
            this.log.warn(warning);
        }
        if (errors.length > 0) {
            for (const error of errors) {
                this.log.error(error);
            }
            this.log.error('Invalid configuration; plugin will not start until it is corrected.');
            return;
        }
        this.log.info(`Initializing ${this.config.name ?? settings_1.PLATFORM_NAME} platform`);
        this.tokenManager = new api_1.TokenManager({
            consumerKey: config.credentials.consumerKey,
            consumerSecret: config.credentials.consumerSecret,
            refreshToken: config.credentials.refreshToken,
            accessToken: config.credentials.accessToken,
            logger: this.log,
            onRefreshToken: token => this.persistRefreshToken(token),
        });
        this.client = new api_1.ResideoApiClient({
            tokenManager: this.tokenManager,
            apikey: config.credentials.consumerKey,
            logger: this.log,
        });
        this.api.on('didFinishLaunching', () => {
            void this.discoverDevices();
        });
        this.api.on('shutdown', () => {
            this.stopped = true;
            if (this.pollTimer) {
                clearInterval(this.pollTimer);
            }
            if (this.discoveryTimer) {
                clearTimeout(this.discoveryTimer);
            }
        });
    }
    /** Restore an accessory from the Homebridge cache. */
    configureAccessory(accessory) {
        this.accessories.push(accessory);
    }
    get refreshRateMs() {
        const configured = this.config.options?.refreshRate ?? settings_1.DEFAULT_REFRESH_RATE_SEC;
        return Math.max(configured, settings_1.MIN_REFRESH_RATE_SEC) * 1000;
    }
    async discoverDevices() {
        if (!this.client || this.stopped) {
            return;
        }
        try {
            const locations = await this.client.getLocations();
            // The await above can span a shutdown; if so, stop before wiring anything
            // up (registering accessories or starting a poll timer that nothing clears).
            if (this.stopped) {
                return;
            }
            const detectors = [];
            for (const location of locations) {
                for (const device of location.devices ?? []) {
                    if ((0, utils_1.isWaterLeakDetector)(device)) {
                        detectors.push({ device, locationId: location.locationID });
                    }
                }
            }
            this.log.info(`Discovered ${detectors.length} water leak detector(s)`);
            for (const { device, locationId } of detectors) {
                this.registerDevice(device, locationId);
            }
            this.pruneStaleAccessories(new Set(detectors.map(d => d.device.deviceID)));
            this.discoveryAttempt = 0;
            await this.runPollCycle();
            this.startPolling();
        }
        catch (err) {
            this.handleError('discoverDevices', err);
            if (this.isFatal(err)) {
                this.log.error('Discovery failed with a non-recoverable error; not retrying automatically.');
                return;
            }
            this.scheduleDiscoveryRetry();
        }
    }
    /** Errors that re-linking or fixing credentials can't be retried away from. */
    isFatal(err) {
        return err instanceof errors_1.RefreshTokenInvalidError
            || err instanceof errors_1.ConfigurationError
            || err instanceof errors_1.AuthenticationError;
    }
    /**
     * Retry discovery with capped exponential backoff so a transient outage at
     * boot doesn't leave the plugin permanently inert until a manual restart.
     */
    scheduleDiscoveryRetry() {
        if (this.stopped) {
            return;
        }
        this.discoveryAttempt++;
        const wait = Math.min(settings_1.INITIAL_DISCOVERY_RETRY_MS * 2 ** (this.discoveryAttempt - 1), settings_1.MAX_DISCOVERY_RETRY_MS);
        this.log.warn(`Retrying device discovery in ${Math.round(wait / 1000)}s (attempt ${this.discoveryAttempt})`);
        this.discoveryTimer = setTimeout(() => {
            void this.discoverDevices();
        }, wait);
    }
    registerDevice(device, locationId) {
        const options = this.optionsForDevice(device.deviceID);
        const displayName = options.name || device.userDefinedDeviceName || 'Water Leak Detector';
        const uuid = this.api.hap.uuid.generate(`${settings_1.UUID_PREFIX}${device.deviceID}`);
        this.locationByDevice.set(device.deviceID, locationId);
        let accessory = this.accessories.find(a => a.UUID === uuid);
        if (accessory) {
            accessory.context.device = device;
            this.api.updatePlatformAccessories([accessory]);
        }
        else {
            accessory = new this.api.platformAccessory(displayName, uuid);
            accessory.context.device = device;
            this.api.registerPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [accessory]);
            this.accessories.push(accessory);
            this.log.info(`Registered new water leak detector: ${displayName}`);
        }
        const handler = new leak_sensor_1.LeakSensorAccessory(this, accessory, options, this.config.options?.freezeThresholdCelsius);
        this.handlers.set(device.deviceID, handler);
    }
    /** Unregister cached accessories that are no longer present in the account. */
    pruneStaleAccessories(currentDeviceIds) {
        const stale = this.accessories.filter((accessory) => {
            const device = accessory.context.device;
            return Boolean(device?.deviceID) && !currentDeviceIds.has(device.deviceID);
        });
        if (stale.length === 0) {
            return;
        }
        this.api.unregisterPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, stale);
        for (const accessory of stale) {
            const index = this.accessories.indexOf(accessory);
            if (index !== -1) {
                this.accessories.splice(index, 1);
            }
            const device = accessory.context.device;
            if (device?.deviceID) {
                this.handlers.delete(device.deviceID);
                this.locationByDevice.delete(device.deviceID);
            }
            this.log.info(`Removed stale water leak detector: ${accessory.displayName}`);
        }
    }
    optionsForDevice(deviceID) {
        const override = this.config.options?.devices?.find(d => d.deviceID === deviceID);
        return override ?? { deviceID };
    }
    startPolling() {
        if (this.stopped) {
            return;
        }
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
        }
        this.pollTimer = setInterval(() => {
            void this.runPollCycle();
        }, this.refreshRateMs);
    }
    /** Run one poll cycle, skipping if a previous cycle is still in flight. */
    async runPollCycle() {
        if (this.stopped) {
            return;
        }
        if (this.isPolling) {
            this.log.debug('Skipping poll tick; previous cycle still running');
            return;
        }
        this.isPolling = true;
        try {
            await this.pollAll();
        }
        finally {
            this.isPolling = false;
        }
    }
    /** Poll every device with bounded concurrency so cycle time stays bounded. */
    async pollAll() {
        if (!this.client) {
            return;
        }
        // Snapshot the device IDs that currently have a known location. Each worker
        // re-checks per device below, since pruning/discovery can mutate the maps
        // while a cycle is in flight.
        const deviceIds = [...this.handlers.keys()].filter(id => this.locationByDevice.has(id));
        const workerCount = Math.min(settings_1.POLL_DEVICE_CONCURRENCY, deviceIds.length);
        if (workerCount === 0) {
            return;
        }
        let nextIndex = 0;
        const worker = async () => {
            while (nextIndex < deviceIds.length) {
                const deviceID = deviceIds[nextIndex++];
                const locationId = this.locationByDevice.get(deviceID);
                const handler = this.handlers.get(deviceID);
                if (locationId === undefined || !handler || !this.client) {
                    continue;
                }
                try {
                    const device = await this.client.getWaterLeakDetector(deviceID, locationId);
                    handler.updateStatus(device);
                }
                catch (err) {
                    this.handleError(`poll ${deviceID}`, err);
                }
            }
        };
        await Promise.all(Array.from({ length: workerCount }, () => worker()));
    }
    handleError(context, err) {
        if (err instanceof errors_1.RefreshTokenInvalidError) {
            this.log.error(`[${context}] Refresh token invalid. Re-link your account in the plugin settings.`);
            return;
        }
        if (err instanceof errors_1.ConfigurationError) {
            this.log.error(`[${context}] ${err.message}`);
            return;
        }
        this.log.error(`[${context}] ${(0, utils_1.sanitizeError)(err)}`);
    }
    /**
     * Persist a rotated refresh token back into config.json so it survives a
     * Homebridge restart. Best-effort: failures are logged, not thrown. Writes
     * atomically (temp file + rename) so a crash mid-write cannot corrupt config.
     */
    async persistRefreshToken(newRefreshToken) {
        this.config.credentials.refreshToken = newRefreshToken;
        try {
            const configPath = this.api.user.configPath();
            const raw = await node_fs_1.promises.readFile(configPath, 'utf8');
            const parsed = JSON.parse(raw);
            const blocks = parsed.platforms?.filter(p => p.platform === settings_1.PLATFORM_NAME) ?? [];
            const block = blocks.find(p => p.name === this.config.name) ?? blocks[0];
            if (block?.credentials) {
                block.credentials.refreshToken = newRefreshToken;
                const tempPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
                await node_fs_1.promises.writeFile(tempPath, JSON.stringify(parsed, null, 4), 'utf8');
                await node_fs_1.promises.rename(tempPath, configPath);
                this.log.debug(`Persisted rotated refresh token to config.json (${(0, utils_1.maskToken)(newRefreshToken)})`);
            }
        }
        catch (err) {
            this.log.warn(`Could not persist rotated refresh token: ${(0, utils_1.sanitizeError)(err)}`);
        }
    }
}
exports.default = ResideoPlatform;
//# sourceMappingURL=platform.js.map