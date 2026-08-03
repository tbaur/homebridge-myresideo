/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import {
  formatDiagnosticLine,
  formatHealthTransitionLine,
  formatRestTransportState,
  resolveRestTransportState,
} from '../../../src/diagnostics/format'
import type { DiagnosticsSnapshot } from '../../../src/types'

function baseReport(overrides: Partial<DiagnosticsSnapshot> = {}): DiagnosticsSnapshot {
  return {
    msg: 'health',
    lifecycle: {
      health: 'healthy',
      reasons: [],
      uptimeSec: 60,
      pluginVersion: '1.0.0',
    },
    devices: { cloud: 5, total: 5, online: 5, leak: 0, lowBattery: 0 },
    transport: { restState: 'running' },
    circuitBreaker: { state: 'CLOSED', lastTripAt: null, trips: 0 },
    polling: { cadenceSec: 120, lastDurationMs: 548, ok: 450, failed: 0 },
    token: { expiresInSec: 1000, lastRefreshAt: null, refreshes: 0 },
    api: { p50Ms: 407, p95Ms: 612, requests: 450, errors: 0 },
    activity: { retries: 0, stateChanges: 0 },
    ...overrides,
  }
}

describe('resolveRestTransportState', () => {
  it('returns stopped when the platform is shutting down', () => {
    expect(resolveRestTransportState({
      stopped: true,
      authFailed: true,
      pollingArmed: true,
    })).toBe('stopped')
  })

  it('returns auth-failed when token refresh is failing', () => {
    expect(resolveRestTransportState({
      stopped: false,
      authFailed: true,
      pollingArmed: true,
    })).toBe('auth-failed')
  })

  it('returns connecting when the poll loop is not armed yet', () => {
    expect(resolveRestTransportState({
      stopped: false,
      authFailed: false,
      pollingArmed: false,
    })).toBe('connecting')
  })

  it('returns running when polling is armed and auth is healthy', () => {
    expect(resolveRestTransportState({
      stopped: false,
      authFailed: false,
      pollingArmed: true,
    })).toBe('running')
  })
})

describe('formatRestTransportState', () => {
  it('maps running to live and leaves other states unchanged', () => {
    expect(formatRestTransportState('running')).toBe('live')
    expect(formatRestTransportState('connecting')).toBe('connecting')
    expect(formatRestTransportState('stopped')).toBe('stopped')
    expect(formatRestTransportState('auth-failed')).toBe('auth-failed')
  })
})

describe('formatDiagnosticLine', () => {
  it('formats the sibling-style healthy line with rest live', () => {
    expect(formatDiagnosticLine(baseReport())).toBe(
      'Health: healthy | devices 5/5 | rest live | '
      + 'api p50 407ms p95 612ms (req 450, err 0)',
    )
  })

  it('surfaces leak, breaker, and non-live rest states', () => {
    expect(formatDiagnosticLine(baseReport({
      msg: 'diagnostics.stop',
      lifecycle: {
        health: 'degraded',
        reasons: ['tokenRefreshFailing', 'circuitBreakerOpen'],
        uptimeSec: 60,
        pluginVersion: '1.0.0',
      },
      devices: { cloud: 5, total: 5, online: 4, leak: 1, lowBattery: 0 },
      transport: { restState: 'auth-failed' },
      circuitBreaker: { state: 'OPEN', lastTripAt: 1, trips: 1 },
    }))).toBe(
      'Diagnostics stop: degraded [tokenRefreshFailing, circuitBreakerOpen] | '
      + 'devices 4/5 (1 leak) | breaker OPEN | rest auth-failed | '
      + 'api p50 407ms p95 612ms (req 450, err 0)',
    )
  })

  it('formats connecting and stopped rest states', () => {
    expect(formatDiagnosticLine(baseReport({
      transport: { restState: 'connecting' },
    }))).toContain('rest connecting')

    expect(formatDiagnosticLine(baseReport({
      msg: 'diagnostics.stop',
      transport: { restState: 'stopped' },
    }))).toBe(
      'Diagnostics stop: healthy | devices 5/5 | rest stopped | '
      + 'api p50 407ms p95 612ms (req 450, err 0)',
    )
  })
})

describe('formatHealthTransitionLine', () => {
  it('keeps transitions concise', () => {
    expect(formatHealthTransitionLine(baseReport({
      msg: 'health.degraded',
      lifecycle: {
        health: 'degraded',
        reasons: ['emptyDiscovery'],
        uptimeSec: 10,
        pluginVersion: '1.0.0',
      },
    }))).toBe('Health degraded: degraded [emptyDiscovery]')

    expect(formatHealthTransitionLine(baseReport({
      msg: 'health.recovered',
    }))).toBe('Health recovered: healthy')
  })
})
