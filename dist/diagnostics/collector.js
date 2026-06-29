"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Opt-in diagnostics collector for health/activity metrics.
 *
 * One collector is owned per platform instance. It accumulates cumulative
 * counters and a bounded latency window, and turns them into:
 *   - `buildHeartbeat()` — per-interval counter deltas + absolute gauges
 *   - `snapshot()`       — session cumulative totals + redacted config echo
 *   - `rollup()`         — `{ health, reasons[] }` health classification
 *
 * This is the polling-only Resideo variant of the myleviton collector: there is
 * no WebSocket, circuit breaker, rate limiter, or cache, so those subsystems are
 * absent. It only ever reads in-memory state via the supplied `readers`; it
 * never performs any network I/O.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiagnosticsCollector = void 0;
/** Maximum number of recent request latencies retained for percentile math. */
const LATENCY_WINDOW = 200;
/** Recent request outcomes retained for the rollup error-rate calculation. */
const OUTCOME_WINDOW = 50;
/** Minimum recent requests before the API error rate can mark health degraded. */
const API_ERROR_MIN_SAMPLES = 10;
/** Recent error rate (0..1) at or above which health is considered degraded. */
const API_ERROR_RATE_THRESHOLD = 0.5;
/**
 * Accumulates diagnostics counters and renders heartbeat/snapshot reports.
 */
class DiagnosticsCollector {
    now;
    startedAtMs;
    pluginVersion;
    configEcho;
    // Cumulative counters
    apiRequests = 0;
    apiErrors = 0;
    pollOk = 0;
    pollFailed = 0;
    tokenRefreshes = 0;
    retries = 0;
    stateChanges = 0;
    // Internal gauges advanced by increment methods
    lastPollDurationMs = null;
    /** Outcome of the most recent poll cycle, used by the rollup. */
    lastPollOk = null;
    lastPollFailed = null;
    // Bounded windows
    latencies = [];
    recentOutcomes = [];
    // Marker captured at the previous heartbeat, used to derive deltas
    marker;
    constructor(options) {
        this.now = options.now ?? Date.now;
        this.startedAtMs = this.now();
        this.pluginVersion = options.pluginVersion;
        this.configEcho = redactConfig(options.config);
        this.marker = this.captureCounters();
    }
    /**
     * Record a single API request outcome and its wall-clock duration. Fires for
     * every networked request, including timeouts and errors (ok === false).
     */
    apiRequest(latencyMs, ok) {
        this.apiRequests++;
        if (!ok) {
            this.apiErrors++;
        }
        if (Number.isFinite(latencyMs) && latencyMs >= 0) {
            this.latencies.push(latencyMs);
            if (this.latencies.length > LATENCY_WINDOW) {
                this.latencies.shift();
            }
        }
        this.recentOutcomes.push(ok);
        if (this.recentOutcomes.length > OUTCOME_WINDOW) {
            this.recentOutcomes.shift();
        }
    }
    /**
     * Record the result of a polling cycle: how many device fetches succeeded,
     * how many failed, and the total cycle duration.
     */
    pollCycle(ok, failed, durationMs) {
        this.pollOk += ok;
        this.pollFailed += failed;
        this.lastPollOk = ok;
        this.lastPollFailed = failed;
        if (Number.isFinite(durationMs) && durationMs >= 0) {
            this.lastPollDurationMs = durationMs;
        }
    }
    /** Record a successful token refresh. */
    tokenRefresh() {
        this.tokenRefreshes++;
    }
    /** Record an API request retry (transient failure or the 401 refresh-retry). */
    retry() {
        this.retries++;
    }
    /** Record a device state transition observed during a poll. */
    stateChange() {
        this.stateChanges++;
    }
    /**
     * Nearest-rank percentile (0..100) over the bounded recent-latency window.
     * Returns 0 when no samples are available.
     */
    percentile(p) {
        if (this.latencies.length === 0) {
            return 0;
        }
        const sorted = [...this.latencies].sort((a, b) => a - b);
        const clamped = Math.min(100, Math.max(0, p));
        const rank = Math.ceil((clamped / 100) * sorted.length);
        const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
        return sorted[index];
    }
    /**
     * Classify current health from live readers. Health is degraded if any of:
     * the recent API error rate is at or over threshold with a minimum sample
     * size; a token refresh is currently in its failure cooldown; or the last
     * completed poll cycle failed every device (`failed > 0 && ok === 0`).
     */
    rollup(readers) {
        const reasons = [];
        const total = this.recentOutcomes.length;
        if (total >= API_ERROR_MIN_SAMPLES) {
            const errors = this.recentOutcomes.filter(ok => !ok).length;
            if (errors / total >= API_ERROR_RATE_THRESHOLD) {
                reasons.push('apiErrorRateHigh');
            }
        }
        if (readers.tokenRefreshFailureActive()) {
            reasons.push('tokenRefreshFailing');
        }
        // Degraded only when the last completed cycle attempted devices and every
        // one failed. A cycle that polled nothing (`ok === 0 && failed === 0`, e.g.
        // no devices, or all skipped by a mid-cycle prune/discovery race) is not a
        // stall and must not raise a false positive. Skipped ticks (a cycle still
        // running) never call pollCycle(), so this intentionally reflects the last
        // *completed* cycle and clears on the next completed cycle.
        if (this.lastPollFailed !== null && this.lastPollFailed > 0 && this.lastPollOk === 0) {
            reasons.push('pollingStalled');
        }
        return {
            health: reasons.length > 0 ? 'degraded' : 'healthy',
            reasons,
        };
    }
    /**
     * Build a heartbeat report: counters are deltas since the previous heartbeat
     * (the marker is then advanced) and everything else is an absolute gauge.
     */
    buildHeartbeat(readers) {
        const current = this.captureCounters();
        const counters = {
            refreshes: current.tokenRefreshes - this.marker.tokenRefreshes,
            pollOk: current.pollOk - this.marker.pollOk,
            pollFailed: current.pollFailed - this.marker.pollFailed,
            requests: current.apiRequests - this.marker.apiRequests,
            errors: current.apiErrors - this.marker.apiErrors,
            retries: current.retries - this.marker.retries,
            stateChanges: current.stateChanges - this.marker.stateChanges,
        };
        const report = this.buildReport('health', counters, readers);
        this.marker = current;
        return report;
    }
    /**
     * Build a session-cumulative snapshot (no marker advance), including the
     * redacted config echo. Used for boot/shutdown reports.
     */
    snapshot(msg, readers) {
        const counters = {
            refreshes: this.tokenRefreshes,
            pollOk: this.pollOk,
            pollFailed: this.pollFailed,
            requests: this.apiRequests,
            errors: this.apiErrors,
            retries: this.retries,
            stateChanges: this.stateChanges,
        };
        const report = this.buildReport(msg, counters, readers);
        report.config = { ...this.configEcho };
        return report;
    }
    /** Seconds since the collector was created. */
    uptimeSec() {
        return Math.round((this.now() - this.startedAtMs) / 1000);
    }
    captureCounters() {
        return {
            apiRequests: this.apiRequests,
            apiErrors: this.apiErrors,
            pollOk: this.pollOk,
            pollFailed: this.pollFailed,
            tokenRefreshes: this.tokenRefreshes,
            retries: this.retries,
            stateChanges: this.stateChanges,
        };
    }
    buildReport(msg, counters, readers) {
        const { health, reasons } = this.rollup(readers);
        return {
            msg,
            lifecycle: {
                health,
                reasons,
                uptimeSec: this.uptimeSec(),
                pluginVersion: this.pluginVersion,
            },
            devices: readers.devices(),
            polling: {
                cadenceSec: readers.pollingCadenceSec(),
                lastDurationMs: this.lastPollDurationMs,
                ok: counters.pollOk,
                failed: counters.pollFailed,
            },
            token: {
                expiresInSec: readers.tokenExpiresInSec(),
                lastRefreshAt: readers.tokenLastRefreshAt(),
                refreshes: counters.refreshes,
            },
            api: {
                p50Ms: this.percentile(50),
                p95Ms: this.percentile(95),
                requests: counters.requests,
                errors: counters.errors,
            },
            activity: {
                retries: counters.retries,
                stateChanges: counters.stateChanges,
            },
        };
    }
}
exports.DiagnosticsCollector = DiagnosticsCollector;
/**
 * Build a redacted echo of the plugin config for snapshots. Credentials are
 * never included; the per-device array is reduced to a count to keep the echo
 * compact and free of device-identifying data.
 */
function redactConfig(config) {
    const options = config.options;
    return {
        diagnosticsInterval: options?.diagnosticsInterval ?? 0,
        refreshRate: options?.refreshRate ?? null,
        structuredLogs: options?.structuredLogs ?? false,
        freezeThresholdCelsius: options?.freezeThresholdCelsius ?? null,
        devices: Array.isArray(options?.devices) ? options.devices.length : 0,
    };
}
//# sourceMappingURL=collector.js.map