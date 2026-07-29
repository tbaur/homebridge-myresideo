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
const collector_1 = require("./diagnostics/collector");
const errors_1 = require("./errors");
const settings_1 = require("./settings");
const utils_1 = require("./utils");
/**
 * Installed plugin version, used for diagnostics lifecycle reporting.
 *
 * Resolved via `require` rather than a static `import`: `package.json` lives
 * outside the TypeScript `rootDir` (`src/`), so importing it would alter the
 * emitted `dist/` layout. The require resolves correctly from both the compiled
 * `dist/` output and ts-jest.
 */
function readPluginVersion() {
    try {
        return require('../package.json').version || 'unknown';
    }
    catch {
        return 'unknown';
    }
}
const PLUGIN_VERSION = readPluginVersion();
/** How many times to rewrite config.json if a concurrent save clobbers the new tokens. */
const TOKEN_PERSIST_MAX_ATTEMPTS = 3;
/** Clamp a configured interval into the range a timer can represent safely. */
function clampSeconds(seconds, min, max) {
    return Math.min(Math.max(seconds, min), max);
}
/**
 * Write `contents` to `path` and flush it to disk before returning.
 *
 * `fs.writeFile` closes its handle without an fsync, so the data may still be in
 * the page cache when the follow-up rename publishes the file. A crash in that
 * window would leave a truncated config — and since the whole file is rewritten,
 * that costs the user every platform's settings, not just these tokens.
 */
async function writeFileDurable(path, contents) {
    const handle = await node_fs_1.promises.open(path, 'w');
    try {
        await handle.writeFile(contents, 'utf8');
        await handle.sync();
    }
    finally {
        await handle.close();
    }
}
class ResideoPlatform {
    log;
    api;
    Service;
    Characteristic;
    accessories = [];
    config;
    handlers = new Map();
    locationByDevice = new Map();
    /** Device IDs whose one-line boot state summary has already been logged, so a
     *  discovery retry that re-registers the same detectors does not re-log it. */
    bootSummaryLogged = new Set();
    /**
     * Consecutive non-empty discoveries that omitted each device ID. Cleared when
     * the device reappears; removal requires {@link STALE_REMOVAL_CONFIRMATIONS}.
     */
    pendingRemovalCounts = new Map();
    tokenManager;
    client;
    pollTimer;
    discoveryTimer;
    discoveryAttempt = 0;
    isPolling = false;
    stopped = false;
    /** True when startup validation failed; the platform stays inert. */
    disabled = false;
    // Opt-in diagnostics subsystem (off unless options.diagnosticsInterval > 0).
    diagnostics;
    diagnosticsTimer;
    lastDiagnosticsHealth = null;
    /** Detectors returned by Resideo at the last trusted (fully reconciled) discovery. */
    lastCloudDetectorCount = 0;
    /** Epoch ms of the last failed token refresh, for the degraded-health window. */
    lastRefreshFailureAt = null;
    /**
     * True while discovery is retrying after an empty cloud device list. Feeds
     * diagnostics `emptyDiscovery` so heartbeats are not falsely "healthy".
     */
    emptyDiscoveryActive = false;
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
            this.disabled = true;
            return;
        }
        this.log.info(`Initializing ${this.config.name ?? settings_1.PLATFORM_NAME} platform`);
        // The collector is created before the client/token manager so their metric
        // hooks can feed it. It is cheap and purely in-memory; nothing is emitted
        // to the log unless options.diagnosticsInterval > 0.
        this.diagnostics = new collector_1.DiagnosticsCollector({ pluginVersion: PLUGIN_VERSION, config });
        this.tokenManager = new api_1.TokenManager({
            consumerKey: config.credentials.consumerKey,
            consumerSecret: config.credentials.consumerSecret,
            refreshToken: config.credentials.refreshToken,
            accessToken: config.credentials.accessToken,
            logger: this.log,
            onRefreshToken: tokens => this.persistTokens(tokens),
            onRefreshSuccess: () => {
                this.lastRefreshFailureAt = null;
                this.diagnostics?.tokenRefresh();
            },
            onRefreshFailure: () => {
                this.lastRefreshFailureAt = Date.now();
            },
        });
        this.client = new api_1.ResideoApiClient({
            tokenManager: this.tokenManager,
            apikey: config.credentials.consumerKey,
            logger: this.log,
            metrics: sample => this.diagnostics?.apiRequest(sample.durationMs, sample.ok),
            onRetry: () => this.diagnostics?.retry(),
            onCircuitOpen: () => this.diagnostics?.breakerTrip(),
        });
        this.api.on('didFinishLaunching', () => {
            void this.discoverDevices();
        });
        this.api.on('shutdown', () => {
            this.stopped = true;
            this.stopDiagnostics();
            if (this.pollTimer) {
                clearInterval(this.pollTimer);
                this.pollTimer = undefined;
            }
            if (this.discoveryTimer) {
                clearTimeout(this.discoveryTimer);
                this.discoveryTimer = undefined;
            }
        });
    }
    /**
     * Record a device state transition (leak/offline/battery/freeze) for the
     * diagnostics activity counter. Called by the accessory handlers. The collector
     * accumulates counters whenever the platform is active (regardless of
     * `diagnosticsInterval`); only emission to the log is gated on the interval, so
     * this is a no-op only when the platform was disabled by invalid config.
     */
    recordStateChange() {
        this.diagnostics?.stateChange();
    }
    /** Restore an accessory from the Homebridge cache. */
    configureAccessory(accessory) {
        if (this.disabled) {
            this.log.debug(`Platform disabled by invalid config; cached accessory "${accessory.displayName}" will not be updated.`);
        }
        this.accessories.push(accessory);
    }
    get refreshRateMs() {
        // Both ends of the range are hazards, and both collapse to a tight poll loop.
        // A non-finite refreshRate (a stray string, or Infinity) must never reach
        // setInterval, since Math.max(NaN, min) is NaN which setInterval coerces to 0;
        // and Node clamps any delay above 2^31-1 ms to 1 ms. So fall back to the
        // default for non-numbers, then clamp into the supported range.
        const configured = this.config.options?.refreshRate;
        const seconds = typeof configured === 'number' && Number.isFinite(configured)
            ? configured
            : settings_1.DEFAULT_REFRESH_RATE_SEC;
        return clampSeconds(seconds, settings_1.MIN_REFRESH_RATE_SEC, settings_1.MAX_REFRESH_RATE_SEC) * 1000;
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
                    if (!(0, utils_1.isWaterLeakDetector)(device)) {
                        continue;
                    }
                    // A detector with no deviceID cannot be mapped to a stable accessory:
                    // registering it would produce an accessory that pruneCorruptAccessories
                    // later deletes. Skip it and say so rather than churning HomeKit.
                    if (!(0, utils_1.hasUsableDeviceId)(device)) {
                        this.log.warn(`Skipping a leak detector in location ${location.locationID} that Resideo `
                            + 'reported without a deviceID; it cannot be mapped to a HomeKit accessory.');
                        continue;
                    }
                    detectors.push({ device, locationId: location.locationID });
                }
            }
            // After a few empty retries, keep looking but stop spamming per-attempt
            // info/warn. A long Resideo outage would otherwise fill the Homebridge log;
            // we still emit an occasional status line so quiet ≠ gave up.
            const quietEmptyRetry = (detectors.length === 0
                && this.discoveryAttempt >= settings_1.EMPTY_DISCOVERY_QUIET_AFTER_ATTEMPTS);
            if (quietEmptyRetry) {
                this.log.debug(`Discovered ${detectors.length} water leak detector(s)`);
            }
            else {
                this.log.info(`Discovered ${detectors.length} water leak detector(s)`);
            }
            // An empty locations/devices payload during a Resideo outage looks like a
            // successful discovery of zero detectors. Never treat that as terminal:
            // pruning would wipe HomeKit when cache remains, and accepting 0 with an
            // empty cache (e.g. after a prior wipe) would sit idle until a manual
            // restart even after the cloud recovers. Keep/restore what we can and retry.
            // Empty responses also must not count toward stale-removal confirmation.
            if (detectors.length === 0) {
                this.emptyDiscoveryActive = true;
                const cachedDetectorCount = this.countCachedDetectors();
                if (cachedDetectorCount > 0) {
                    const message = (`Discovery returned 0 detectors while ${cachedDetectorCount} cached `
                        + `accessor${cachedDetectorCount === 1 ? 'y' : 'ies'} remain; skipping stale `
                        + 'removal and retrying (empty cloud responses must not wipe HomeKit).');
                    if (quietEmptyRetry) {
                        this.log.debug(message);
                    }
                    else {
                        this.log.warn(message);
                    }
                    // Corrupt cache entries without a deviceID are still safe to drop.
                    this.pruneCorruptAccessories();
                    this.restoreHandlersFromCache();
                    if (this.handlers.size > 0) {
                        await this.runPollCycle();
                        this.startPolling();
                        this.startDiagnostics();
                    }
                }
                else {
                    const message = ('Discovery returned 0 detectors; retrying in case this is a transient empty cloud response.');
                    if (quietEmptyRetry) {
                        this.log.debug(message);
                    }
                    else {
                        this.log.warn(message);
                    }
                    this.startDiagnostics();
                }
                this.logEmptyDiscoveryStatus();
                this.scheduleDiscoveryRetry();
                return;
            }
            this.emptyDiscoveryActive = false;
            for (const { device, locationId } of detectors) {
                this.registerDevice(device, locationId);
            }
            this.pruneCorruptAccessories();
            const discoveredIds = new Set(detectors.map(d => d.device.deviceID));
            const hasUnresolvedMissing = this.cachedDetectorIds().some(id => !discoveredIds.has(id));
            // Never advance stale-removal confirmations or unregister while unstable
            // (degraded health, open breaker, or empty-discovery mode).
            if (this.canSafelyRemoveStaleDetectors()) {
                this.reconcileMissingDetectors(discoveredIds);
            }
            else if (hasUnresolvedMissing) {
                this.log.warn('Cloud list is missing cached detector(s) but the platform is unstable; '
                    + 'not removing accessories yet');
            }
            // Partial / unresolved lists keep polling what we have and re-discover
            // until missing detectors are confirmed gone (or they reappear).
            if (this.pendingRemovalCounts.size > 0 || hasUnresolvedMissing) {
                this.discoveryAttempt = 0;
                await this.runPollCycle();
                this.startPolling();
                this.startDiagnostics();
                this.scheduleDiscoveryRetry();
                return;
            }
            this.lastCloudDetectorCount = detectors.length;
            this.discoveryAttempt = 0;
            await this.runPollCycle();
            this.startPolling();
            this.startDiagnostics();
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
    /**
     * Errors that retrying discovery cannot resolve, so we stop instead of
     * looping the capped backoff forever and spamming the log. This covers bad
     * credentials/re-link conditions ({@link AuthenticationError} and its
     * {@link RefreshTokenInvalidError} subclass, {@link ConfigurationError}), a
     * permissions problem ({@link ForbiddenError}), and any non-retryable HTTP
     * response such as a 404 ({@link ApiResponseError} with `isRetryable === false`).
     * Transient 5xx/network/timeout errors remain retryable. A one-off
     * {@link ApiParseError} (e.g. HTML/WAF body) is also retried — permanent
     * schema breaks will keep failing until the cloud recovers or the user
     * intervenes, but will not leave the plugin inert after a single blip.
     */
    isFatal(err) {
        if (err instanceof errors_1.AuthenticationError
            || err instanceof errors_1.ConfigurationError
            || err instanceof errors_1.ForbiddenError) {
            return true;
        }
        if (err instanceof errors_1.ApiResponseError) {
            return !err.isRetryable;
        }
        return false;
    }
    /**
     * Retry discovery with capped exponential backoff so a transient outage at
     * boot doesn't leave the plugin permanently inert until a manual restart.
     */
    scheduleDiscoveryRetry() {
        if (this.stopped) {
            return;
        }
        if (this.discoveryTimer) {
            clearTimeout(this.discoveryTimer);
        }
        this.discoveryAttempt++;
        // Same jittered exponential backoff as API/token retries so recovering
        // instances do not align on identical wait times.
        const wait = (0, utils_1.backoffMs)(this.discoveryAttempt, settings_1.INITIAL_DISCOVERY_RETRY_MS, settings_1.MAX_DISCOVERY_RETRY_MS);
        const message = `Retrying device discovery in ${Math.round(wait / 1000)}s (attempt ${this.discoveryAttempt})`;
        // Keep the first few retries visible during an outage; after that demote so a
        // long outage does not warn forever at the 5-minute cap.
        if (this.discoveryAttempt <= settings_1.EMPTY_DISCOVERY_QUIET_AFTER_ATTEMPTS) {
            this.log.warn(message);
        }
        else {
            this.log.debug(message);
        }
        this.discoveryTimer = setTimeout(() => {
            this.discoveryTimer = undefined;
            void this.discoverDevices();
        }, wait);
    }
    /**
     * When empty-discovery retries go quiet, say so once so the log does not imply
     * discovery stopped. Further empty attempts stay at debug until recovery.
     */
    logEmptyDiscoveryStatus() {
        if (this.discoveryAttempt !== settings_1.EMPTY_DISCOVERY_QUIET_AFTER_ATTEMPTS) {
            return;
        }
        const waitSec = Math.round(settings_1.MAX_DISCOVERY_RETRY_MS / 1000);
        this.log.info(`Retrying discovery every ${waitSec}s (next message upon recovery)`);
    }
    registerDevice(device, locationId) {
        const rawOptions = this.optionsForDevice(device.deviceID);
        // Drop out-of-range/non-numeric thresholds here so the device's own limit
        // (or the plugin default) is used, matching what validateConfig warns about.
        const options = {
            ...rawOptions,
            freezeThresholdCelsius: (0, utils_1.sanitizeFreezeThreshold)(rawOptions.freezeThresholdCelsius),
        };
        const defaultFreezeThreshold = (0, utils_1.sanitizeFreezeThreshold)(this.config.options?.freezeThresholdCelsius);
        const displayName = options.name || device.userDefinedDeviceName || 'Water Leak Detector';
        const uuid = this.api.hap.uuid.generate(`${settings_1.UUID_PREFIX}${device.deviceID}`);
        this.locationByDevice.set(device.deviceID, locationId);
        let accessory = this.accessories.find(a => a.UUID === uuid);
        if (accessory) {
            accessory.context.device = device;
            // Persist locationId so a later empty-discovery outage can keep polling
            // from cache instead of waiting for a full locations payload to return.
            accessory.context.locationId = locationId;
            // Keep the cached accessory's name in step with a changed config/device name.
            accessory.displayName = displayName;
            this.api.updatePlatformAccessories([accessory]);
        }
        else {
            accessory = new this.api.platformAccessory(displayName, uuid);
            accessory.context.device = device;
            accessory.context.locationId = locationId;
            this.api.registerPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [accessory]);
            this.accessories.push(accessory);
            this.log.info(`Registered new water leak detector: ${displayName}`);
        }
        const handler = new leak_sensor_1.LeakSensorAccessory(this, accessory, options, defaultFreezeThreshold);
        this.handlers.set(device.deviceID, handler);
        // One-line state summary at boot so the log shows each detector's condition,
        // not just the discovered count. Healthy devices read calmly; problems are
        // capitalized in the summary so they stand out (see describeDeviceState). Logged
        // once per device (the accessory establishes its baseline silently, so this is
        // the single startup state report) and never re-logged on a discovery retry.
        if (!this.bootSummaryLogged.has(device.deviceID)) {
            this.bootSummaryLogged.add(device.deviceID);
            const summary = `${displayName}: ${(0, utils_1.describeDeviceState)(device, options, defaultFreezeThreshold)}`;
            // A leak or active alarm at startup is an actionable condition, so surface it
            // at warn (matching the prior first-poll behavior); routine state stays info.
            if ((0, utils_1.isLeakDetected)(device) || (0, utils_1.hasActiveAlarms)(device)) {
                this.log.warn(summary);
            }
            else {
                this.log.info(summary);
            }
        }
    }
    /** Count cached accessories that look like real detectors (have a deviceID). */
    countCachedDetectors() {
        return this.cachedDetectorIds().length;
    }
    /** Device IDs present on currently cached accessories. */
    cachedDetectorIds() {
        const ids = [];
        for (const accessory of this.accessories) {
            const id = accessory.context.device?.deviceID;
            if (id !== undefined && id !== '') {
                ids.push(id);
            }
        }
        return ids;
    }
    /**
     * Re-wire handlers from Homebridge cache when discovery returns empty but
     * accessories still carry a device + locationId from a prior successful pass.
     */
    restoreHandlersFromCache() {
        for (const accessory of this.accessories) {
            const device = accessory.context.device;
            const locationId = accessory.context.locationId;
            if (!device?.deviceID || typeof locationId !== 'number' || Number.isNaN(locationId)) {
                continue;
            }
            if (this.handlers.has(device.deviceID)) {
                continue;
            }
            this.registerDevice(device, locationId);
        }
    }
    /** Drop corrupt cache entries that have no deviceID; leave real detectors alone. */
    pruneCorruptAccessories() {
        this.unregisterAccessories(this.accessories.filter((accessory) => {
            const id = accessory.context.device?.deviceID;
            return id === undefined || id === '';
        }));
    }
    /**
     * Stale removal is allowed only when the platform looks stable: circuit breaker
     * closed, not in empty-discovery retry, and diagnostics health is not degraded
     * (API failures / token issues / polling stalled / empty discovery).
     */
    canSafelyRemoveStaleDetectors() {
        if (this.emptyDiscoveryActive) {
            return false;
        }
        const breakerState = this.client?.getStatus().circuitBreaker.state ?? 'CLOSED';
        if (breakerState !== 'CLOSED') {
            return false;
        }
        if (this.diagnostics) {
            const { health } = this.diagnostics.rollup(this.buildDiagnosticsReaders());
            if (health === 'degraded') {
                return false;
            }
        }
        return true;
    }
    /**
     * Track detectors missing from a non-empty discovery and only unregister after
     * {@link STALE_REMOVAL_CONFIRMATIONS} consecutive omissions. A single partial
     * cloud list must not wipe accessories. Caller must ensure
     * {@link canSafelyRemoveStaleDetectors} is true.
     */
    reconcileMissingDetectors(discoveredIds) {
        if (!this.canSafelyRemoveStaleDetectors()) {
            return;
        }
        for (const id of discoveredIds) {
            this.pendingRemovalCounts.delete(id);
        }
        const confirmed = [];
        for (const accessory of this.accessories) {
            const id = accessory.context.device?.deviceID;
            if (id === undefined || id === '' || discoveredIds.has(id)) {
                continue;
            }
            const count = (this.pendingRemovalCounts.get(id) ?? 0) + 1;
            this.pendingRemovalCounts.set(id, count);
            if (count >= settings_1.STALE_REMOVAL_CONFIRMATIONS) {
                confirmed.push(accessory);
                continue;
            }
            this.log.warn(`Detector ${accessory.displayName} missing from cloud `
                + `(${count}/${settings_1.STALE_REMOVAL_CONFIRMATIONS}); not removing yet`);
        }
        // Re-check immediately before unregister in case health flipped mid-loop.
        if (confirmed.length > 0 && this.canSafelyRemoveStaleDetectors()) {
            this.unregisterAccessories(confirmed);
        }
        else if (confirmed.length > 0) {
            this.log.warn(`Deferring removal of ${confirmed.length} detector(s); platform became unstable`);
            for (const accessory of confirmed) {
                const id = accessory.context.device?.deviceID;
                if (id) {
                    // Hold at the confirmation threshold without removing.
                    this.pendingRemovalCounts.set(id, settings_1.STALE_REMOVAL_CONFIRMATIONS);
                }
            }
        }
    }
    unregisterAccessories(stale) {
        if (stale.length === 0) {
            return;
        }
        this.api.unregisterPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, stale);
        for (const accessory of stale) {
            const index = this.accessories.indexOf(accessory);
            if (index !== -1) {
                this.accessories.splice(index, 1);
            }
            const cachedId = accessory.context.device?.deviceID;
            // A corrupt entry has lost its deviceID, so fall back to a UUID reverse
            // lookup: leaving the handler/location entries behind would keep polling a
            // detector that no longer exists in HomeKit and skew the device gauges.
            const deviceID = cachedId || this.trackedDeviceIdForUuid(accessory.UUID);
            if (deviceID) {
                this.handlers.delete(deviceID);
                this.locationByDevice.delete(deviceID);
                this.pendingRemovalCounts.delete(deviceID);
                // Forget the boot-summary marker so a detector that later returns to the
                // account is reported again rather than being silently re-added.
                this.bootSummaryLogged.delete(deviceID);
            }
            if (cachedId) {
                this.log.info(`Removed stale water leak detector: ${accessory.displayName}`);
            }
            else {
                this.log.warn(`Removed cached accessory without a deviceID: ${accessory.displayName}`);
            }
        }
    }
    /** Tracked device ID whose generated accessory UUID matches `uuid`, if any. */
    trackedDeviceIdForUuid(uuid) {
        for (const deviceID of this.handlers.keys()) {
            if (this.api.hap.uuid.generate(`${settings_1.UUID_PREFIX}${deviceID}`) === uuid) {
                return deviceID;
            }
        }
        return undefined;
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
        const cycleStart = Date.now();
        try {
            const { ok, failed } = await this.pollAll();
            this.diagnostics?.pollCycle(ok, failed, Date.now() - cycleStart);
        }
        finally {
            this.isPolling = false;
        }
    }
    /**
     * Poll every device with bounded concurrency so cycle time stays bounded.
     * Returns per-cycle success/failure counts for diagnostics.
     */
    async pollAll() {
        if (!this.client) {
            return { ok: 0, failed: 0 };
        }
        // Snapshot the device IDs that currently have a known location. Each worker
        // re-checks per device below, since pruning/discovery can mutate the maps
        // while a cycle is in flight.
        const deviceIds = [...this.handlers.keys()].filter(id => this.locationByDevice.has(id));
        const workerCount = Math.min(settings_1.POLL_DEVICE_CONCURRENCY, deviceIds.length);
        if (workerCount === 0) {
            return { ok: 0, failed: 0 };
        }
        let nextIndex = 0;
        let ok = 0;
        let failed = 0;
        // One actionable auth/config error log per cycle so concurrent workers do
        // not spam the same re-link message, while later cycles still surface it.
        let loggedAuthFailureThisCycle = false;
        const worker = async () => {
            while (nextIndex < deviceIds.length) {
                if (this.stopped) {
                    return;
                }
                const deviceID = deviceIds[nextIndex++];
                const locationId = this.locationByDevice.get(deviceID);
                const handler = this.handlers.get(deviceID);
                if (locationId === undefined || !handler || !this.client) {
                    continue;
                }
                // End-to-end poll latency for the per-check-in report. This wraps the
                // whole call, so it includes any client retries/backoff — it is not the
                // single successful-attempt latency that feeds the diagnostics p50/p95.
                const startedAt = Date.now();
                try {
                    const device = await this.client.getWaterLeakDetector(deviceID, locationId);
                    if (this.stopped) {
                        return;
                    }
                    handler.updateStatus(device, Date.now() - startedAt);
                    ok++;
                }
                catch (err) {
                    // Preserve HomeKit state on API failure. Transient / open-breaker
                    // misses stay at debug (myleviton pattern); circuit-breaker transitions
                    // are the operator-visible outage signal. Auth/config failures still
                    // surface once per cycle via handleError so re-link signaling is not
                    // demoted to debug after discovery has already succeeded.
                    failed++;
                    if (this.isActionablePollError(err) && !loggedAuthFailureThisCycle) {
                        loggedAuthFailureThisCycle = true;
                        this.handleError('poll', err);
                    }
                    else {
                        this.log.debug(`Polling skipped for ${handler.displayName}: ${(0, utils_1.sanitizeError)(err)}`);
                    }
                }
            }
        };
        await Promise.all(Array.from({ length: workerCount }, () => worker()));
        return { ok, failed };
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
        if (err instanceof errors_1.ForbiddenError) {
            this.log.error(`[${context}] Resideo refused access (HTTP 403). Confirm this developer app is authorized `
                + 'for the account and that the linked user can still access the detectors.');
            return;
        }
        if (err instanceof errors_1.AuthenticationError) {
            this.log.error(`[${context}] Authentication failed. Re-link your account in the plugin settings, or verify `
                + 'the Consumer Key and Secret.');
            return;
        }
        this.log.error(`[${context}] ${(0, utils_1.sanitizeError)(err)}`);
    }
    /**
     * Errors that must stay visible at error level during polling (re-link /
     * credentials / permissions). Transient API outages are not included.
     */
    isActionablePollError(err) {
        return (err instanceof errors_1.RefreshTokenInvalidError
            || err instanceof errors_1.AuthenticationError
            || err instanceof errors_1.ForbiddenError
            || err instanceof errors_1.ConfigurationError);
    }
    /** Diagnostics heartbeat interval in milliseconds (0 when disabled). */
    diagnosticsIntervalMs() {
        const seconds = this.config.options?.diagnosticsInterval;
        if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
            return 0;
        }
        return clampSeconds(seconds, settings_1.MIN_DIAGNOSTICS_INTERVAL_SEC, settings_1.MAX_DIAGNOSTICS_INTERVAL_SEC) * 1000;
    }
    /** Effective polling cadence in seconds (mirrors refreshRateMs clamping). */
    pollingCadenceSeconds() {
        return Math.round(this.refreshRateMs / 1000);
    }
    /**
     * Start the diagnostics subsystem: emit the boot snapshot and schedule the
     * heartbeat. No-op unless options.diagnosticsInterval > 0. Diagnostics must
     * never be able to crash the host, so emission is wrapped defensively.
     */
    startDiagnostics() {
        const interval = this.diagnosticsIntervalMs();
        if (interval <= 0 || this.stopped || this.diagnosticsTimer || !this.diagnostics) {
            return;
        }
        try {
            const startReport = this.diagnostics.snapshot('diagnostics.start', this.buildDiagnosticsReaders());
            this.lastDiagnosticsHealth = startReport.lifecycle.health;
            this.emitDiagnostic('info', startReport);
        }
        catch (err) {
            this.log.debug(`Failed to emit diagnostics start snapshot: ${(0, utils_1.sanitizeError)(err)}`);
        }
        this.diagnosticsTimer = setInterval(() => this.diagnosticsHeartbeat(), interval);
    }
    /** Emit the cumulative stop snapshot and tear down the heartbeat timer. */
    stopDiagnostics() {
        if (!this.diagnosticsTimer) {
            return;
        }
        try {
            this.emitDiagnostic('info', this.diagnostics.snapshot('diagnostics.stop', this.buildDiagnosticsReaders()));
        }
        catch (err) {
            this.log.debug(`Failed to emit diagnostics stop snapshot: ${(0, utils_1.sanitizeError)(err)}`);
        }
        clearInterval(this.diagnosticsTimer);
        this.diagnosticsTimer = undefined;
    }
    /**
     * Emit a single heartbeat (per-interval deltas) and log health transitions.
     * Wrapped so a reader failure can never escape the timer and crash Homebridge.
     */
    diagnosticsHeartbeat() {
        if (!this.diagnostics) {
            return;
        }
        try {
            const report = this.diagnostics.buildHeartbeat(this.buildDiagnosticsReaders());
            this.emitDiagnostic('info', report);
            const health = report.lifecycle.health;
            if (this.lastDiagnosticsHealth !== null && health !== this.lastDiagnosticsHealth) {
                const isDegraded = health === 'degraded';
                this.emitDiagnostic(isDegraded ? 'warn' : 'info', {
                    ...report,
                    msg: isDegraded ? 'health.degraded' : 'health.recovered',
                }, { concise: true });
            }
            this.lastDiagnosticsHealth = health;
        }
        catch (err) {
            this.log.debug(`Diagnostics heartbeat failed: ${(0, utils_1.sanitizeError)(err)}`);
        }
    }
    /**
     * Build the synchronous, in-memory readers the collector uses. Never performs
     * network I/O.
     */
    buildDiagnosticsReaders() {
        return {
            clientStatus: () => this.client?.getStatus() ?? { circuitBreaker: { state: 'CLOSED' } },
            devices: () => this.collectDeviceGauges(),
            tokenExpiresInSec: () => this.tokenManager?.getStatus().expiresInSec ?? null,
            tokenLastRefreshAt: () => this.tokenManager?.getStatus().lastRefreshAt ?? null,
            tokenRefreshFailureActive: () => this.lastRefreshFailureAt !== null
                && Date.now() - this.lastRefreshFailureAt < settings_1.TOKEN_REFRESH_FAILURE_COOLDOWN_MS,
            emptyDiscoveryActive: () => this.emptyDiscoveryActive,
            pollingCadenceSec: () => this.pollingCadenceSeconds(),
        };
    }
    /**
     * Compute absolute device gauges from the latest polled state stored on each
     * accessory's context. Reachability and active conditions are the meaningful
     * signals for these read-only sensors.
     */
    collectDeviceGauges() {
        let online = 0;
        let leak = 0;
        let lowBattery = 0;
        for (const accessory of this.accessories) {
            const device = accessory.context.device;
            if (!device) {
                continue;
            }
            if ((0, utils_1.isDeviceActive)(device)) {
                online++;
            }
            if ((0, utils_1.isLeakDetected)(device)) {
                leak++;
            }
            if (device.batteryRemaining !== undefined && (0, utils_1.isLowBattery)(device.batteryRemaining)) {
                lowBattery++;
            }
        }
        return { cloud: this.lastCloudDetectorCount, total: this.handlers.size, online, leak, lowBattery };
    }
    /**
     * Emit a diagnostics report as a human-readable line, plus a structured JSON
     * line when options.structuredLogs is enabled. The report is already redacted.
     */
    emitDiagnostic(level, report, options = {}) {
        // A transition logs a concise state-only human line, since the heartbeat that
        // detected it already emitted the full metrics body; everything else logs the
        // full summary line.
        this.log[level](options.concise ? formatHealthTransitionLine(report) : formatDiagnosticLine(report));
        if (this.config.options?.structuredLogs) {
            // Emit the report as-is: `msg` plus the nested groups (lifecycle, devices,
            // polling, token, api, activity, and the config echo on snapshots). The
            // report is already redacted, so this never carries credentials.
            this.log[level](JSON.stringify(report));
        }
    }
    /**
     * Persist the current refresh + access tokens back into config.json so they
     * survive a Homebridge restart. Rewrites the whole config file as pretty-printed
     * JSON (4-space indent) for the matching platform block — other platforms'
     * values are preserved, but key order/formatting for the file may change.
     *
     * Writes atomically and durably (fsync before rename; Windows rename-aside with
     * restore-on-failure). Token refresh is single-flight, so this never races
     * itself. Against an interleaved Homebridge Config UI X save of the same file,
     * each attempt re-reads immediately before writing (so unrelated option edits
     * are not clobbered from a stale snapshot) and re-reads after promoting to
     * confirm the tokens landed; if Config UI X overwrote them, the write is
     * retried a few times.
     *
     * A failure here is serious — tokens may only be in memory — so it is logged at
     * error with that consequence spelled out, but never thrown (refresh succeeded).
     */
    async persistTokens(tokens) {
        this.config.credentials.refreshToken = tokens.refreshToken;
        this.config.credentials.accessToken = tokens.accessToken;
        const configPath = this.api.user.configPath();
        try {
            for (let attempt = 1; attempt <= TOKEN_PERSIST_MAX_ATTEMPTS; attempt++) {
                const raw = await node_fs_1.promises.readFile(configPath, 'utf8');
                const parsed = JSON.parse(raw);
                const blocks = parsed.platforms?.filter(p => p.platform === settings_1.PLATFORM_NAME) ?? [];
                const block = this.selectConfigBlock(blocks);
                if (!block?.credentials) {
                    this.log.error('Could not persist tokens: this platform block was not found in config.json. '
                        + 'A future Homebridge restart may require re-linking your account.');
                    return;
                }
                block.credentials.refreshToken = tokens.refreshToken;
                block.credentials.accessToken = tokens.accessToken;
                const tempPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
                await writeFileDurable(tempPath, JSON.stringify(parsed, null, 4));
                await this.replaceConfigFile(tempPath, configPath);
                if (await this.configHasTokens(configPath, tokens)) {
                    this.log.debug('Persisted refresh and access tokens to config.json');
                    return;
                }
                if (attempt < TOKEN_PERSIST_MAX_ATTEMPTS) {
                    this.log.warn('Token persist was overwritten before it could be confirmed; retrying '
                        + `(attempt ${attempt}/${TOKEN_PERSIST_MAX_ATTEMPTS})`);
                }
            }
            this.log.error('Could not persist tokens: config.json did not retain the new tokens after '
                + `${TOKEN_PERSIST_MAX_ATTEMPTS} attempts. `
                + 'A future Homebridge restart may require re-linking your account.');
        }
        catch (err) {
            this.log.error(`Could not persist tokens: ${(0, utils_1.sanitizeError)(err)}. `
                + 'A future Homebridge restart may require re-linking your account.');
        }
    }
    /**
     * True when `configPath` currently stores exactly the given tokens on this
     * platform block. Used to detect a lost race against Config UI X saving over
     * the just-promoted file.
     */
    async configHasTokens(configPath, tokens) {
        try {
            const raw = await node_fs_1.promises.readFile(configPath, 'utf8');
            const parsed = JSON.parse(raw);
            const blocks = parsed.platforms?.filter(p => p.platform === settings_1.PLATFORM_NAME) ?? [];
            const block = this.selectConfigBlock(blocks);
            return block?.credentials?.refreshToken === tokens.refreshToken
                && block?.credentials?.accessToken === tokens.accessToken;
        }
        catch {
            return false;
        }
    }
    /**
     * Replace `configPath` with the contents already written to `tempPath`.
     * Prefer a direct rename (atomic on POSIX). When the platform refuses to
     * overwrite (typical on Windows), move the live file aside, promote the
     * temp file, and restore the backup if promotion fails — never `unlink` the
     * live config before the new file is durable.
     */
    async replaceConfigFile(tempPath, configPath) {
        try {
            await node_fs_1.promises.rename(tempPath, configPath);
            return;
        }
        catch (renameErr) {
            const code = renameErr.code;
            if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'EACCES') {
                throw renameErr;
            }
        }
        const backupPath = `${configPath}.${process.pid}.${Date.now()}.bak`;
        await node_fs_1.promises.rename(configPath, backupPath);
        try {
            await node_fs_1.promises.rename(tempPath, configPath);
        }
        catch (promoteErr) {
            try {
                await node_fs_1.promises.rename(backupPath, configPath);
            }
            catch (restoreErr) {
                throw new Error(`Failed to promote new config and restore backup: ${(0, utils_1.sanitizeError)(promoteErr)}; `
                    + `restore: ${(0, utils_1.sanitizeError)(restoreErr)}`);
            }
            throw promoteErr;
        }
        await node_fs_1.promises.rm(backupPath, { force: true });
    }
    /**
     * Choose which platform block to write the rotated token into. With a single
     * block the choice is unambiguous; with several, only a unique name match is
     * safe. Refuse to guess when names collide or none match this instance.
     */
    selectConfigBlock(blocks) {
        if (blocks.length <= 1) {
            return blocks[0];
        }
        const named = blocks.filter(p => p.name === this.config.name);
        if (named.length === 1) {
            return named[0];
        }
        if (named.length === 0) {
            this.log.error('Could not persist tokens: no MyResideo platform block matches this '
                + `instance name ("${this.config.name ?? ''}"). Ensure the "name" in config.json matches.`);
            return undefined;
        }
        this.log.error('Multiple MyResideo platform blocks share the same name; cannot safely persist tokens. '
            + 'Give each platform block a unique "name" in config.json.');
        return undefined;
    }
}
exports.default = ResideoPlatform;
/** Human-readable label for a diagnostics channel (structured JSON keeps `msg`). */
function diagnosticLabel(msg) {
    switch (msg) {
        case 'health':
            return 'Health';
        case 'diagnostics.start':
            return 'Diagnostics start';
        case 'diagnostics.stop':
            return 'Diagnostics stop';
        case 'health.degraded':
            return 'Health degraded';
        case 'health.recovered':
            return 'Health recovered';
        default:
            return msg;
    }
}
/** Render the bracketed reason list shown after the health state (empty when healthy). */
function formatReasons(reasons) {
    return reasons.length > 0 ? ` [${reasons.join(', ')}]` : '';
}
/** Build the concise human-readable summary line for a diagnostics report. */
function formatDiagnosticLine(report) {
    const { lifecycle, devices, circuitBreaker, polling, api, activity } = report;
    const reasonText = formatReasons(lifecycle.reasons);
    const pollDuration = polling.lastDurationMs === null ? 'n/a' : `${polling.lastDurationMs}ms`;
    // Keep the healthy-path line short. Leak count and breaker state only appear
    // when they carry signal (an active leak, or a breaker that is not CLOSED);
    // token expiry and zero leak/CLOSED breaker stay in the structured-JSON report
    // for parsers. This plugin is polling-only, so each device poll is one API
    // request: report poll outcome once and keep only the latency percentiles as
    // the API signal.
    const parts = [
        `${diagnosticLabel(report.msg)}: ${lifecycle.health}${reasonText}`,
        devices.leak > 0
            ? `devices ${devices.online}/${devices.total} (${devices.leak} leak)`
            : `devices ${devices.online}/${devices.total}`,
    ];
    if (circuitBreaker.state !== 'CLOSED') {
        parts.push(`breaker ${circuitBreaker.state}`);
    }
    parts.push(`poll ${pollDuration} ok ${polling.ok} failed ${polling.failed} retried ${activity.retries}`, `api p50 ${api.p50Ms}ms p95 ${api.p95Ms}ms`);
    return parts.join(' | ');
}
/**
 * Concise health-transition notice: state and reasons only. The heartbeat that
 * detected the change already emitted the full metrics body on the line above,
 * so repeating it here would just duplicate that content. Degraded transitions
 * are logged at warn, so this keeps the actionable reasons visible in
 * warn-filtered logs without the redundant tail.
 */
function formatHealthTransitionLine(report) {
    const reasonText = formatReasons(report.lifecycle.reasons);
    return `${diagnosticLabel(report.msg)}: ${report.lifecycle.health}${reasonText}`;
}
//# sourceMappingURL=platform.js.map