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
import type { PagerDutySignalsOptions, SignalState } from './pagerduty-signals';
import type { WaterLeakDetector } from './types';
/** Logged once, in this order, when the setting is on. */
export declare const PAGERDUTY_STARTUP_LOG = "homebridge-pagerduty support is enabled (leak, detector-offline, low-battery, auth-failed, cloud-offline)";
export declare const SIGNAL_LEAK = "leak";
export declare const SIGNAL_DETECTOR_OFFLINE = "detector-offline";
export declare const SIGNAL_LOW_BATTERY = "low-battery";
export declare const SIGNAL_AUTH_FAILED = "auth-failed";
export declare const SIGNAL_CLOUD_OFFLINE = "cloud-offline";
/** How long a detector body must stay absent before cloud-offline turns on. */
export declare const CLOUD_OFFLINE_GRACE_MS: number;
/** How often to retry the cloud-offline write while that outage is still on. */
export declare const CLOUD_WRITE_RETRY_MS: number;
export declare const LEAK_SUMMARY = "A water leak detector is wet.";
export declare const DETECTOR_OFFLINE_SUMMARY = "A water leak detector is offline.";
export declare const LOW_BATTERY_SUMMARY = "A water leak detector battery is low.";
export declare const AUTH_REJECTED_SUMMARY = "Resideo rejected the account link. This plugin has stopped until the account is linked again in Homebridge.";
export declare const AUTH_FORBIDDEN_SUMMARY = "Resideo refused access for this developer app. This plugin has stopped until that app is allowed to see the detectors.";
export declare const AUTH_CREDENTIALS_SUMMARY = "Resideo rejected the API credentials. This plugin has stopped until the Consumer Key and Secret are corrected in Homebridge.";
export declare const CLOUD_OFFLINE_SUMMARY = "Homebridge has not reached Resideo for 5 minutes. Leak detector state in HomeKit may be stale.";
export declare const CLOUD_DEGRADED_SUMMARY = "Resideo reports every water leak detector offline. This is most likely a Resideo cloud problem.";
/** Fewest published detectors for an all-offline report to count as a cloud problem. */
export declare const CLOUD_DEGRADED_MIN_DETECTORS = 2;
/** Why sign-in stopped. The summary depends on it. The signal name does not. */
export type SignInFailure = 'rejected' | 'forbidden' | 'credentials';
/** The subset of the store writer this class uses. */
export interface SignalWriter {
    write(signal: string, state: SignalState): void;
    close(): void;
}
/**
 * Classify an error for the auth-failed page.
 *
 * Undefined means the failure is not a stopped sign-in. A 401 the client is
 * about to refresh never arrives here. The AuthenticationError that does is
 * the one that remained after that refresh. RefreshTokenInvalidError is a
 * subclass, so it has to be named before the parent.
 */
export declare function signalFailureFrom(error: unknown): SignInFailure | undefined;
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
export declare class ResideoSignals {
    #private;
    constructor(writer: SignalWriter, graceMs?: number);
    /**
     * Start the offline grace.
     *
     * Does not write. Call once, before the first request, so an outage already
     * under way at launch still pages. Later failures do not push this timer out.
     */
    start(): void;
    /**
     * Record one detector body that just arrived.
     *
     * Leak and low battery raise at once. Offline waits for settle, which can
     * tell one offline detector from a cloud that reports all of them offline.
     * Does not clear. A missing battery is not a low battery. Omitted
     * reachability fields are online, matching isDeviceActive. isOfflineHeld
     * means the offline report is still inside the hold and is not believed yet.
     */
    observe(device: WaterLeakDetector, isOfflineHeld?: boolean): void;
    /**
     * Store a body that arrived while a poll is already in flight.
     *
     * A true flag is stored, and leak or low battery is written. A false flag
     * does not replace a true one, and this does not mark the detector covered,
     * so the in-flight poll can still refuse a clear.
     */
    raiseOnly(device: WaterLeakDetector, isOfflineHeld?: boolean): void;
    /**
     * Start a poll.
     *
     * inherit keeps coverage from the locations list that just ran, so a GET
     * that throws still counts as the body that list already supplied. A later
     * poll does not inherit: a detector that was not read this cycle blocks the clear.
     */
    beginPoll(inherit: boolean): void;
    /**
     * Write clears once every published detector has a body in coverage.
     *
     * Drops readings for detectors that are no longer published, then recomputes
     * the house OR. An id still published but not covered blocks the clear.
     * Zero published detectors is a real clear: the last one was removed, which
     * is not an empty cloud list.
     */
    settle(publishedIds: readonly string[]): void;
    /**
     * Drop one detector that left HomeKit and recompute.
     *
     * The remaining detectors keep their readings. A removed wet detector
     * clears the house leak once the others are covered.
     */
    release(deviceId: string, publishedIds: readonly string[]): void;
    /**
     * Sign-in has stopped.
     *
     * Cancels the outage grace and writes cloud-offline inactive. Does not
     * change leak, offline, or battery. Latched until a later cycle reaches
     * Resideo without another auth failure.
     */
    noteAuth(failure: SignInFailure): void;
    /**
     * A locations list or device poll reached Resideo.
     *
     * Ends the outage grace and writes cloud-offline inactive. Does not change
     * auth-failed. The poll that follows a locations list decides that.
     */
    noteCloudReached(): void;
    /**
     * This cycle reached Resideo and did not see a stopped sign-in.
     *
     * Clears auth and the outage grace. When auth is latched, the grace still
     * ends and cloud-offline stays off, and the auth page stays up.
     */
    noteReached(): void;
    /**
     * No detector body in this attempt.
     *
     * Arms the grace if it is not already running. Does not extend it, and
     * does nothing while auth-failed is on.
     */
    noteOutage(): void;
    /** Close the store and stop the grace timer. Does not clear any signal. */
    close(): void;
}
/** Build the signals for this plugin, backed by the homebridge-pagerduty store. */
export declare function createResideoSignals(options: PagerDutySignalsOptions): ResideoSignals;
//# sourceMappingURL=resideo-signals.d.ts.map