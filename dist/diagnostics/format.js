"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Human-readable formatting for diagnostics reports.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveRestTransportState = resolveRestTransportState;
exports.formatRestTransportState = formatRestTransportState;
exports.diagnosticLabel = diagnosticLabel;
exports.formatReasons = formatReasons;
exports.formatDiagnosticLine = formatDiagnosticLine;
exports.formatHealthTransitionLine = formatHealthTransitionLine;
/**
 * Resolve the REST transport lifecycle from platform flags.
 *
 * Priority matches mynest's transport status: stopped and auth-failed win over
 * the normal running/connecting path. Circuit-breaker trips stay on the separate
 * `breaker` segment — they do not rewrite rest state.
 */
function resolveRestTransportState(flags) {
    if (flags.stopped) {
        return 'stopped';
    }
    if (flags.authFailed) {
        return 'auth-failed';
    }
    // Poll loop not armed yet (initial discovery, or empty-cloud retry with no
    // cached devices to poll): still bringing the REST path up.
    if (!flags.pollingArmed) {
        return 'connecting';
    }
    return 'running';
}
/** Short operator-facing label for the REST transport lifecycle state. */
function formatRestTransportState(state) {
    switch (state) {
        case 'running':
            return 'live';
        case 'auth-failed':
            return 'auth-failed';
        case 'connecting':
        case 'stopped':
            return state;
        default: {
            const _exhaustive = state;
            return _exhaustive;
        }
    }
}
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
    const { lifecycle, devices, circuitBreaker, transport, api } = report;
    const reasonText = formatReasons(lifecycle.reasons);
    // Sibling shape: Health | devices | rest <state> | api p50/p95 (req, err).
    // Leak count and breaker state only appear when they carry signal; token
    // expiry, poll duration, and retries stay in the structured-JSON report.
    const parts = [
        `${diagnosticLabel(report.msg)}: ${lifecycle.health}${reasonText}`,
        devices.leak > 0
            ? `devices ${devices.online}/${devices.total} (${devices.leak} leak)`
            : `devices ${devices.online}/${devices.total}`,
    ];
    if (circuitBreaker.state !== 'CLOSED') {
        parts.push(`breaker ${circuitBreaker.state}`);
    }
    parts.push(`rest ${formatRestTransportState(transport.restState)}`, `api p50 ${api.p50Ms}ms p95 ${api.p95Ms}ms (req ${api.requests}, err ${api.errors})`);
    return parts.join(' | ');
}
/**
 * Concise health-transition notice: state and reasons only. The heartbeat that
 * detected the change already emitted the full metrics body on the line above,
 * so repeating it here would just duplicate that content.
 */
function formatHealthTransitionLine(report) {
    const reasonText = formatReasons(report.lifecycle.reasons);
    return `${diagnosticLabel(report.msg)}: ${report.lifecycle.health}${reasonText}`;
}
//# sourceMappingURL=format.js.map