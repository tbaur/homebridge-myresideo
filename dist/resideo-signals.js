"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Which Resideo detector conditions are worth a PagerDuty page.
 *
 * The store writer is the copied module. This file owns the house-level OR,
 * the five-minute outage grace, and which errors mean sign-in has stopped.
 * It does not read the store. A detector name never enters a summary.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResideoSignals = exports.CLOUD_DEGRADED_MIN_DETECTORS = exports.CLOUD_DEGRADED_SUMMARY = exports.CLOUD_OFFLINE_SUMMARY = exports.AUTH_CREDENTIALS_SUMMARY = exports.AUTH_FORBIDDEN_SUMMARY = exports.AUTH_REJECTED_SUMMARY = exports.LOW_BATTERY_SUMMARY = exports.DETECTOR_OFFLINE_SUMMARY = exports.LEAK_SUMMARY = exports.CLOUD_WRITE_RETRY_MS = exports.CLOUD_OFFLINE_GRACE_MS = exports.SIGNAL_CLOUD_OFFLINE = exports.SIGNAL_AUTH_FAILED = exports.SIGNAL_LOW_BATTERY = exports.SIGNAL_DETECTOR_OFFLINE = exports.SIGNAL_LEAK = exports.PAGERDUTY_STARTUP_LOG = void 0;
exports.signalFailureFrom = signalFailureFrom;
exports.createResideoSignals = createResideoSignals;
const errors_1 = require("./errors");
const pagerduty_signals_1 = require("./pagerduty-signals");
const mappers_1 = require("./utils/mappers");
/** Logged once, in this order, when the setting is on. */
exports.PAGERDUTY_STARTUP_LOG = 'homebridge-pagerduty support is enabled (leak, detector-offline, low-battery, auth-failed, cloud-offline)';
exports.SIGNAL_LEAK = 'leak';
exports.SIGNAL_DETECTOR_OFFLINE = 'detector-offline';
exports.SIGNAL_LOW_BATTERY = 'low-battery';
exports.SIGNAL_AUTH_FAILED = 'auth-failed';
exports.SIGNAL_CLOUD_OFFLINE = 'cloud-offline';
/** How long a detector body must stay absent before cloud-offline turns on. */
exports.CLOUD_OFFLINE_GRACE_MS = 5 * 60 * 1000;
/** How often to retry the cloud-offline write while that outage is still on. */
exports.CLOUD_WRITE_RETRY_MS = 30 * 1000;
exports.LEAK_SUMMARY = 'A water leak detector is wet.';
exports.DETECTOR_OFFLINE_SUMMARY = 'A water leak detector is offline.';
exports.LOW_BATTERY_SUMMARY = 'A water leak detector battery is low.';
exports.AUTH_REJECTED_SUMMARY = 'Resideo rejected the account link. This plugin has stopped until the account is linked again in Homebridge.';
exports.AUTH_FORBIDDEN_SUMMARY = 'Resideo refused access for this developer app. This plugin has stopped until that app is allowed to see the detectors.';
exports.AUTH_CREDENTIALS_SUMMARY = 'Resideo rejected the API credentials. This plugin has stopped until the Consumer Key and Secret are corrected in Homebridge.';
exports.CLOUD_OFFLINE_SUMMARY = 'Homebridge has not reached Resideo for 5 minutes. Leak detector state in HomeKit may be stale.';
exports.CLOUD_DEGRADED_SUMMARY = 'Resideo reports every water leak detector offline. This is most likely a Resideo cloud problem.';
/** Fewest published detectors for an all-offline report to count as a cloud problem. */
exports.CLOUD_DEGRADED_MIN_DETECTORS = 2;
function readingFrom(device, isOfflineHeld) {
    return {
        leak: (0, mappers_1.isLeakDetected)(device),
        offline: !isOfflineHeld && !(0, mappers_1.isDeviceActive)(device),
        lowBattery: (0, mappers_1.isLowBattery)(device.batteryRemaining),
    };
}
/**
 * Classify an error for the auth-failed page.
 *
 * Undefined means the failure is not a stopped sign-in. A 401 the client is
 * about to refresh never arrives here. The AuthenticationError that does is
 * the one that remained after that refresh. RefreshTokenInvalidError is a
 * subclass, so it has to be named before the parent.
 */
function signalFailureFrom(error) {
    if (error instanceof errors_1.RefreshTokenInvalidError) {
        return 'rejected';
    }
    if (error instanceof errors_1.ConfigurationError) {
        return 'credentials';
    }
    if (error instanceof errors_1.ForbiddenError) {
        return 'forbidden';
    }
    if (error instanceof errors_1.AuthenticationError) {
        return 'rejected';
    }
    return undefined;
}
/**
 * House-level PagerDuty signals for the detectors this plugin is publishing.
 *
 * A body that says leak or low battery pages immediately. Offline pages when
 * settle runs. If every published detector is offline, that is a cloud problem
 * and pages cloud-offline instead of detector-offline. A clear
 * is written only when every detector still published has a body in the
 * current coverage set. An empty cloud list and a thrown read are not a
 * clear. Shutdown closes the writer and leaves every row as it was.
 */
class ResideoSignals {
    #writer;
    #graceMs;
    #readings = new Map();
    /** Detector ids whose current reading may justify a clear. */
    #covered = new Set();
    #offlineTimer = null;
    #cloudRetry = null;
    #isCloudOfflineConfirmed = false;
    /** Resideo answered, but reported every published detector offline. */
    #isCloudDegraded = false;
    #cloudSummary = exports.CLOUD_OFFLINE_SUMMARY;
    #isAuthRejected = false;
    /** This poll saw a stopped sign-in. noteReached must not clear it. */
    #authLatched = false;
    /** Kept so a clear writes the same sentence the page used. */
    #authFailure = 'rejected';
    #hasStarted = false;
    #isClosed = false;
    constructor(writer, graceMs = exports.CLOUD_OFFLINE_GRACE_MS) {
        this.#writer = writer;
        this.#graceMs = graceMs;
    }
    /**
     * Start the offline grace.
     *
     * Does not write. Call once, before the first request, so an outage already
     * under way at launch still pages. Later failures do not push this timer out.
     */
    start() {
        if (this.#isClosed || this.#hasStarted) {
            return;
        }
        this.#hasStarted = true;
        this.#armOfflineGrace();
    }
    /**
     * Record one detector body that just arrived.
     *
     * Leak and low battery raise at once. Offline waits for settle, which can
     * tell one offline detector from a cloud that reports all of them offline.
     * Does not clear. A missing battery is not a low battery. Omitted
     * reachability fields are online, matching isDeviceActive. isOfflineHeld
     * means the offline report is still inside the hold and is not believed yet.
     */
    observe(device, isOfflineHeld = false) {
        if (this.#isClosed || device.deviceID.length === 0) {
            return;
        }
        const reading = readingFrom(device, isOfflineHeld);
        this.#readings.set(device.deviceID, reading);
        this.#covered.add(device.deviceID);
        if (reading.leak) {
            this.#writeLeak(true);
        }
        if (reading.lowBattery) {
            this.#writeBattery(true);
        }
    }
    /**
     * Store a body that arrived while a poll is already in flight.
     *
     * A true flag is stored, and leak or low battery is written. A false flag
     * does not replace a true one, and this does not mark the detector covered,
     * so the in-flight poll can still refuse a clear.
     */
    raiseOnly(device, isOfflineHeld = false) {
        if (this.#isClosed || device.deviceID.length === 0) {
            return;
        }
        const next = readingFrom(device, isOfflineHeld);
        const prior = this.#readings.get(device.deviceID);
        const reading = {
            leak: next.leak || prior?.leak === true,
            offline: next.offline || prior?.offline === true,
            lowBattery: next.lowBattery || prior?.lowBattery === true,
        };
        if (!reading.leak && !reading.offline && !reading.lowBattery) {
            return;
        }
        this.#readings.set(device.deviceID, reading);
        if (next.leak) {
            this.#writeLeak(true);
        }
        if (next.lowBattery) {
            this.#writeBattery(true);
        }
    }
    /**
     * Start a poll.
     *
     * inherit keeps coverage from the locations list that just ran, so a GET
     * that throws still counts as the body that list already supplied. A later
     * poll does not inherit: a detector that was not read this cycle blocks the clear.
     */
    beginPoll(inherit) {
        if (this.#isClosed) {
            return;
        }
        this.#authLatched = false;
        if (!inherit) {
            this.#covered.clear();
        }
    }
    /**
     * Write clears once every published detector has a body in coverage.
     *
     * Drops readings for detectors that are no longer published, then recomputes
     * the house OR. An id still published but not covered blocks the clear.
     * Zero published detectors is a real clear: the last one was removed, which
     * is not an empty cloud list.
     */
    settle(publishedIds) {
        if (this.#isClosed) {
            return;
        }
        const published = new Set(publishedIds);
        for (const id of this.#readings.keys()) {
            if (!published.has(id)) {
                this.#readings.delete(id);
                this.#covered.delete(id);
            }
        }
        if (published.size === 0) {
            this.#writeHouse(false, false, false);
            this.#setCloudDegraded(false);
            return;
        }
        for (const id of published) {
            if (!this.#covered.has(id)) {
                return;
            }
        }
        let leak = false;
        let offlineCount = 0;
        let lowBattery = false;
        for (const id of published) {
            const reading = this.#readings.get(id);
            if (!reading) {
                return;
            }
            leak = leak || reading.leak;
            offlineCount += reading.offline ? 1 : 0;
            lowBattery = lowBattery || reading.lowBattery;
        }
        const isEveryDetectorOffline = published.size >= exports.CLOUD_DEGRADED_MIN_DETECTORS
            && offlineCount === published.size;
        this.#writeHouse(leak, offlineCount > 0 && !isEveryDetectorOffline, lowBattery);
        this.#setCloudDegraded(isEveryDetectorOffline);
    }
    /**
     * Drop one detector that left HomeKit and recompute.
     *
     * The remaining detectors keep their readings. A removed wet detector
     * clears the house leak once the others are covered.
     */
    release(deviceId, publishedIds) {
        this.#readings.delete(deviceId);
        this.#covered.delete(deviceId);
        this.settle(publishedIds);
    }
    /**
     * Sign-in has stopped.
     *
     * Cancels the outage grace and writes cloud-offline inactive. Does not
     * change leak, offline, or battery. Latched until a later cycle reaches
     * Resideo without another auth failure.
     */
    noteAuth(failure) {
        if (this.#isClosed) {
            return;
        }
        this.#isAuthRejected = true;
        this.#authLatched = true;
        this.#authFailure = failure;
        this.#isCloudOfflineConfirmed = false;
        this.#clearOfflineTimer();
        this.#clearCloudRetry();
        this.#writeAuth(true);
        this.#writeCloud();
    }
    /**
     * A locations list or device poll reached Resideo.
     *
     * Ends the outage grace and writes cloud-offline inactive. Does not change
     * auth-failed. The poll that follows a locations list decides that.
     */
    noteCloudReached() {
        if (this.#isClosed) {
            return;
        }
        this.#isCloudOfflineConfirmed = false;
        this.#clearOfflineTimer();
        this.#clearCloudRetry();
        this.#writeCloud();
    }
    /**
     * This cycle reached Resideo and did not see a stopped sign-in.
     *
     * Clears auth and the outage grace. When auth is latched, the grace still
     * ends and cloud-offline stays off, and the auth page stays up.
     */
    noteReached() {
        if (this.#isClosed) {
            return;
        }
        this.noteCloudReached();
        if (!this.#authLatched) {
            this.#isAuthRejected = false;
            this.#writeAuth(false);
        }
    }
    /**
     * No detector body in this attempt.
     *
     * Arms the grace if it is not already running. Does not extend it, and
     * does nothing while auth-failed is on.
     */
    noteOutage() {
        if (this.#isClosed || this.#isAuthRejected) {
            return;
        }
        this.#armOfflineGrace();
    }
    /** Close the store and stop the grace timer. Does not clear any signal. */
    close() {
        if (this.#isClosed) {
            return;
        }
        this.#isClosed = true;
        this.#clearOfflineTimer();
        this.#clearCloudRetry();
        this.#writer.close();
    }
    #writeHouse(leak, offline, lowBattery) {
        this.#writeLeak(leak);
        this.#writeOffline(offline);
        this.#writeBattery(lowBattery);
    }
    #writeLeak(active) {
        this.#writer.write(exports.SIGNAL_LEAK, { active, severity: 'critical', summary: exports.LEAK_SUMMARY });
    }
    #writeOffline(active) {
        this.#writer.write(exports.SIGNAL_DETECTOR_OFFLINE, {
            active,
            severity: 'error',
            summary: exports.DETECTOR_OFFLINE_SUMMARY,
        });
    }
    #writeBattery(active) {
        this.#writer.write(exports.SIGNAL_LOW_BATTERY, {
            active,
            severity: 'warning',
            summary: exports.LOW_BATTERY_SUMMARY,
        });
    }
    #writeAuth(active) {
        const summary = this.#authFailure === 'forbidden'
            ? exports.AUTH_FORBIDDEN_SUMMARY
            : this.#authFailure === 'credentials'
                ? exports.AUTH_CREDENTIALS_SUMMARY
                : exports.AUTH_REJECTED_SUMMARY;
        this.#writer.write(exports.SIGNAL_AUTH_FAILED, { active, severity: 'error', summary });
    }
    #setCloudDegraded(isDegraded) {
        if (isDegraded === this.#isCloudDegraded) {
            return;
        }
        this.#isCloudDegraded = isDegraded;
        this.#writeCloud();
    }
    /**
     * One cloud-offline row covers both causes. Resideo not answering wins the
     * summary. A clear repeats the sentence the page used.
     */
    #writeCloud() {
        const active = (this.#isCloudOfflineConfirmed || this.#isCloudDegraded) && !this.#isAuthRejected;
        if (active) {
            this.#cloudSummary = this.#isCloudOfflineConfirmed ? exports.CLOUD_OFFLINE_SUMMARY : exports.CLOUD_DEGRADED_SUMMARY;
        }
        this.#writer.write(exports.SIGNAL_CLOUD_OFFLINE, {
            active,
            severity: 'error',
            summary: this.#cloudSummary,
        });
    }
    #armOfflineGrace() {
        if (this.#offlineTimer !== null || this.#isCloudOfflineConfirmed) {
            return;
        }
        this.#offlineTimer = setTimeout(() => {
            this.#offlineTimer = null;
            if (this.#isClosed || this.#isAuthRejected) {
                return;
            }
            this.#isCloudOfflineConfirmed = true;
            this.#writeCloud();
            this.#scheduleCloudRetry();
        }, this.#graceMs);
        this.#offlineTimer.unref?.();
    }
    #clearOfflineTimer() {
        if (this.#offlineTimer !== null) {
            clearTimeout(this.#offlineTimer);
            this.#offlineTimer = null;
        }
    }
    /**
     * Try the cloud-offline write again while the outage is still on.
     *
     * The store writer skips a repeat once the row is in place, and retries the
     * sqlite write when the previous attempt never landed.
     */
    #scheduleCloudRetry() {
        if (this.#cloudRetry !== null || this.#isClosed) {
            return;
        }
        this.#cloudRetry = setTimeout(() => {
            this.#cloudRetry = null;
            if (this.#isClosed || !this.#isCloudOfflineConfirmed || this.#isAuthRejected) {
                return;
            }
            this.#writeCloud();
            this.#scheduleCloudRetry();
        }, exports.CLOUD_WRITE_RETRY_MS);
        this.#cloudRetry.unref?.();
    }
    #clearCloudRetry() {
        if (this.#cloudRetry !== null) {
            clearTimeout(this.#cloudRetry);
            this.#cloudRetry = null;
        }
    }
}
exports.ResideoSignals = ResideoSignals;
/** Build the signals for this plugin, backed by the homebridge-pagerduty store. */
function createResideoSignals(options) {
    return new ResideoSignals(new pagerduty_signals_1.PagerDutySignals(options));
}
//# sourceMappingURL=resideo-signals.js.map