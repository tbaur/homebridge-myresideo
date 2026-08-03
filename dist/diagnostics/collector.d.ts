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
 * no WebSocket, rate limiter, or cache. The circuit breaker is included so
 * sustained API outages surface as `circuitBreakerOpen` in the health rollup,
 * and an empty locations payload during discovery surfaces as `emptyDiscovery`
 * (HTTP 200 with zero detectors does not trip the breaker).
 * It only ever reads in-memory state via the supplied `readers`; it never
 * performs any network I/O.
 */
import type { DeviceGauges, DiagnosticsSnapshot, ResideoPlatformConfig, RestTransportState } from '../types';
/** Subset of `client.getStatus()` the collector relies on. */
export interface ClientStatusLike {
    circuitBreaker: {
        state: string;
    };
}
/**
 * Accessors the collector calls to read live in-memory state. All are
 * synchronous and must never block on the network.
 */
export interface DiagnosticsReaders {
    clientStatus: () => ClientStatusLike;
    devices: () => DeviceGauges;
    tokenExpiresInSec: () => number | null;
    tokenLastRefreshAt: () => number | null;
    tokenRefreshFailureActive: () => boolean;
    /** True while discovery is retrying after an empty cloud device list. */
    emptyDiscoveryActive: () => boolean;
    pollingCadenceSec: () => number;
    /** Current REST poll-path lifecycle (resolved by the platform). */
    restState: () => RestTransportState;
}
interface CollectorOptions {
    pluginVersion: string;
    config: ResideoPlatformConfig;
    /** Injectable clock for deterministic tests. Defaults to `Date.now`. */
    now?: () => number;
}
/** Health classification result. */
export interface HealthRollup {
    health: 'healthy' | 'degraded';
    reasons: string[];
}
/**
 * Accumulates diagnostics counters and renders heartbeat/snapshot reports.
 */
export declare class DiagnosticsCollector {
    private readonly now;
    private readonly startedAtMs;
    private readonly pluginVersion;
    private readonly configEcho;
    private apiRequests;
    private apiErrors;
    private pollOk;
    private pollFailed;
    private tokenRefreshes;
    private retries;
    private stateChanges;
    private breakerTrips;
    private lastPollDurationMs;
    /** Outcome of the most recent poll cycle, used by the rollup. */
    private lastPollOk;
    private lastPollFailed;
    private lastTripAt;
    private readonly latencies;
    private readonly recentOutcomes;
    private marker;
    constructor(options: CollectorOptions);
    /**
     * Record a single API request outcome and its wall-clock duration. Fires for
     * every networked request, including timeouts and errors (ok === false).
     * Pre-flight rejections (circuit breaker open) are not reported here.
     */
    apiRequest(latencyMs: number, ok: boolean): void;
    /**
     * Record the result of a polling cycle: how many device fetches succeeded,
     * how many failed, and the total cycle duration.
     */
    pollCycle(ok: number, failed: number, durationMs: number): void;
    /** Record a successful token refresh. */
    tokenRefresh(): void;
    /** Record an API request retry (transient failure or the 401 refresh-retry). */
    retry(): void;
    /** Record a device state transition observed during a poll. */
    stateChange(): void;
    /** Record a circuit-breaker trip (transition into the open state). */
    breakerTrip(): void;
    /**
     * Nearest-rank percentile (0..100) over the bounded recent-latency window.
     * Returns 0 when no samples are available.
     */
    percentile(p: number): number;
    /**
     * Classify current health from live readers. Health is degraded if any of:
     * the circuit breaker is open; the recent API error rate is at or over
     * threshold with a minimum sample size; a token refresh is currently in its
     * failure cooldown; discovery is retrying after an empty cloud device list;
     * or the last completed poll cycle failed every device
     * (`failed > 0 && ok === 0`).
     */
    rollup(readers: DiagnosticsReaders): HealthRollup;
    /**
     * Build a heartbeat report: counters are deltas since the previous heartbeat
     * (the marker is then advanced) and everything else is an absolute gauge.
     */
    buildHeartbeat(readers: DiagnosticsReaders): DiagnosticsSnapshot;
    /**
     * Build a session-cumulative snapshot (no marker advance), including the
     * redacted config echo. Used for boot/shutdown reports.
     */
    snapshot(msg: string, readers: DiagnosticsReaders): DiagnosticsSnapshot;
    /** Seconds since the collector was created. */
    private uptimeSec;
    private captureCounters;
    private buildReport;
}
export {};
//# sourceMappingURL=collector.d.ts.map