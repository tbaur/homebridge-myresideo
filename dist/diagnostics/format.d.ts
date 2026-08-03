/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Human-readable formatting for diagnostics reports.
 */
import type { DiagnosticsSnapshot, RestTransportState } from '../types';
/** Inputs used to derive the REST transport lifecycle (mynest-aligned). */
export interface RestTransportFlags {
    /** Platform shutdown has begun. */
    stopped: boolean;
    /** Token refresh is in its failure cooldown. */
    authFailed: boolean;
    /** Device poll interval is armed. */
    pollingArmed: boolean;
}
/**
 * Resolve the REST transport lifecycle from platform flags.
 *
 * Priority matches mynest's transport status: stopped and auth-failed win over
 * the normal running/connecting path. Circuit-breaker trips stay on the separate
 * `breaker` segment — they do not rewrite rest state.
 */
export declare function resolveRestTransportState(flags: RestTransportFlags): RestTransportState;
/** Short operator-facing label for the REST transport lifecycle state. */
export declare function formatRestTransportState(state: RestTransportState): string;
/** Human-readable label for a diagnostics channel (structured JSON keeps `msg`). */
export declare function diagnosticLabel(msg: string): string;
/** Render the bracketed reason list shown after the health state (empty when healthy). */
export declare function formatReasons(reasons: string[]): string;
/** Build the concise human-readable summary line for a diagnostics report. */
export declare function formatDiagnosticLine(report: DiagnosticsSnapshot): string;
/**
 * Concise health-transition notice: state and reasons only. The heartbeat that
 * detected the change already emitted the full metrics body on the line above,
 * so repeating it here would just duplicate that content.
 */
export declare function formatHealthTransitionLine(report: DiagnosticsSnapshot): string;
//# sourceMappingURL=format.d.ts.map