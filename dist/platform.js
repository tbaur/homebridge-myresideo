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
    constructor(log, config, api) {
        this.log = log;
        this.api = api;
        this.Service = api.hap.Service;
        this.Characteristic = api.hap.Characteristic;
        this.config = config;
        if (!this.hasValidCredentials()) {
            this.log.error('Missing Resideo credentials (consumerKey, consumerSecret, refreshToken). '
                + 'Open the plugin settings and link your account. Plugin will not start.');
            return;
        }
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
            timeoutMs: undefined,
            logger: this.log,
        });
        this.api.on('didFinishLaunching', () => {
            void this.discoverDevices();
        });
        this.api.on('shutdown', () => {
            if (this.pollTimer) {
                clearInterval(this.pollTimer);
            }
        });
    }
    /** Restore an accessory from the Homebridge cache. */
    configureAccessory(accessory) {
        this.accessories.push(accessory);
    }
    hasValidCredentials() {
        const c = this.config.credentials;
        return Boolean(c && c.consumerKey && c.consumerSecret && c.refreshToken);
    }
    get refreshRateMs() {
        const configured = this.config.options?.refreshRate ?? settings_1.DEFAULT_REFRESH_RATE_SEC;
        return Math.max(configured, settings_1.MIN_REFRESH_RATE_SEC) * 1000;
    }
    async discoverDevices() {
        if (!this.client) {
            return;
        }
        try {
            const locations = await this.client.getLocations();
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
            this.startPolling();
        }
        catch (err) {
            this.handleError('discoverDevices', err);
        }
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
    optionsForDevice(deviceID) {
        const override = this.config.options?.devices?.find(d => d.deviceID === deviceID);
        return override ?? { deviceID };
    }
    startPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
        }
        this.pollTimer = setInterval(() => {
            void this.pollAll();
        }, this.refreshRateMs);
    }
    async pollAll() {
        if (!this.client) {
            return;
        }
        for (const [deviceID, handler] of this.handlers) {
            const locationId = this.locationByDevice.get(deviceID);
            if (locationId === undefined) {
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
    }
    handleError(context, err) {
        if (err instanceof errors_1.RefreshTokenInvalidError) {
            this.log.error(`[${context}] Refresh token invalid. Re-link your account in the plugin settings.`);
            return;
        }
        const message = err instanceof Error ? err.message : String(err);
        this.log.error(`[${context}] ${message}`);
    }
    /**
     * Persist a rotated refresh token back into config.json so it survives a
     * Homebridge restart. Best-effort: failures are logged, not thrown.
     */
    async persistRefreshToken(newRefreshToken) {
        this.config.credentials.refreshToken = newRefreshToken;
        try {
            const configPath = this.api.user.configPath();
            const raw = await node_fs_1.promises.readFile(configPath, 'utf8');
            const parsed = JSON.parse(raw);
            const block = parsed.platforms?.find(p => p.platform === settings_1.PLATFORM_NAME);
            if (block?.credentials) {
                block.credentials.refreshToken = newRefreshToken;
                await node_fs_1.promises.writeFile(configPath, JSON.stringify(parsed, null, 4), 'utf8');
                this.log.debug('Persisted rotated refresh token to config.json');
            }
        }
        catch (err) {
            this.log.warn(`Could not persist rotated refresh token: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
exports.default = ResideoPlatform;
//# sourceMappingURL=platform.js.map