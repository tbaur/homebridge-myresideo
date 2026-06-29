/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import { DiagnosticsCollector } from '../../../src/diagnostics/collector'
import type { DiagnosticsReaders } from '../../../src/diagnostics/collector'
import type { ResideoPlatformConfig } from '../../../src/types'

const baseConfig = (): ResideoPlatformConfig => ({
  platform: 'MyResideo',
  name: 'My Resideo',
  credentials: {
    consumerKey: 'super-secret-key',
    consumerSecret: 'super-secret-secret',
    accessToken: 'super-secret-access',
    refreshToken: 'super-secret-refresh',
  },
  options: {
    refreshRate: 120,
    diagnosticsInterval: 300,
    structuredLogs: true,
    freezeThresholdCelsius: 2,
    devices: [{ deviceID: 'a' }, { deviceID: 'b' }],
  },
} as ResideoPlatformConfig)

interface MutableReaders {
  readers: DiagnosticsReaders
  devices: { cloud: number, total: number, online: number, leak: number, lowBattery: number }
  tokenExpiresInSec: { value: number | null }
  tokenLastRefreshAt: { value: number | null }
  tokenRefreshFailureActive: { value: boolean }
}

const makeReaders = (): MutableReaders => {
  const devices = { cloud: 2, total: 2, online: 2, leak: 0, lowBattery: 0 }
  const tokenExpiresInSec = { value: 1000 as number | null }
  const tokenLastRefreshAt = { value: null as number | null }
  const tokenRefreshFailureActive = { value: false }

  const readers: DiagnosticsReaders = {
    devices: () => ({ ...devices }),
    tokenExpiresInSec: () => tokenExpiresInSec.value,
    tokenLastRefreshAt: () => tokenLastRefreshAt.value,
    tokenRefreshFailureActive: () => tokenRefreshFailureActive.value,
    pollingCadenceSec: () => 120,
  }

  return { readers, devices, tokenExpiresInSec, tokenLastRefreshAt, tokenRefreshFailureActive }
}

describe('DiagnosticsCollector', () => {
  describe('counter deltas and marker advance', () => {
    it('reports per-interval deltas and advances the marker each heartbeat', () => {
      const m = makeReaders()
      const collector = new DiagnosticsCollector({ pluginVersion: '9.9.9', config: baseConfig() })

      collector.apiRequest(100, true)
      collector.apiRequest(200, false)
      collector.pollCycle(3, 1, 42)
      collector.retry()
      collector.tokenRefresh()
      collector.stateChange()
      collector.stateChange()

      const first = collector.buildHeartbeat(m.readers)
      expect(first.api.requests).toBe(2)
      expect(first.api.errors).toBe(1)
      expect(first.polling.ok).toBe(3)
      expect(first.polling.failed).toBe(1)
      expect(first.polling.lastDurationMs).toBe(42)
      expect(first.activity.retries).toBe(1)
      expect(first.activity.stateChanges).toBe(2)
      expect(first.token.refreshes).toBe(1)

      // Second heartbeat with no new activity → all counter deltas are zero.
      const second = collector.buildHeartbeat(m.readers)
      expect(second.api.requests).toBe(0)
      expect(second.api.errors).toBe(0)
      expect(second.activity.retries).toBe(0)
      expect(second.activity.stateChanges).toBe(0)

      // New activity after the marker is reflected in the next delta only.
      collector.stateChange()
      const third = collector.buildHeartbeat(m.readers)
      expect(third.activity.stateChanges).toBe(1)
    })
  })

  describe('percentile', () => {
    it('returns 0 with no samples', () => {
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })
      expect(collector.percentile(50)).toBe(0)
      expect(collector.percentile(95)).toBe(0)
    })

    it('computes nearest-rank percentiles', () => {
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })
      for (const latency of [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) {
        collector.apiRequest(latency, true)
      }
      expect(collector.percentile(0)).toBe(10)
      expect(collector.percentile(50)).toBe(50)
      expect(collector.percentile(95)).toBe(100)
      expect(collector.percentile(100)).toBe(100)
    })

    it('bounds the latency window to the most recent samples', () => {
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })
      // Push 250 samples; only the last 200 are retained. First 50 (value 1) drop off.
      for (let i = 0; i < 250; i++) {
        collector.apiRequest(i < 50 ? 1 : 500, true)
      }
      expect(collector.percentile(0)).toBe(500)
    })

    it('still counts a failed request even when its latency is zero', () => {
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })
      collector.apiRequest(100, true)
      collector.apiRequest(0, false)
      const m = makeReaders()
      const report = collector.buildHeartbeat(m.readers)
      expect(report.api.requests).toBe(2)
      expect(report.api.errors).toBe(1)
    })
  })

  describe('gauges', () => {
    it('reflects live reader gauges and internal gauge state', () => {
      const m = makeReaders()
      let clock = 1_000_000
      const collector = new DiagnosticsCollector({
        pluginVersion: '3.7.0',
        config: baseConfig(),
        now: () => clock,
      })

      m.devices.online = 1
      m.devices.leak = 1
      m.devices.lowBattery = 2
      collector.pollCycle(1, 0, 77)
      clock += 5000

      const report = collector.buildHeartbeat(m.readers)
      expect(report.lifecycle.pluginVersion).toBe('3.7.0')
      expect(report.lifecycle.uptimeSec).toBe(5)
      expect(report.devices).toEqual({ cloud: 2, total: 2, online: 1, leak: 1, lowBattery: 2 })
      expect(report.polling.cadenceSec).toBe(120)
      expect(report.polling.lastDurationMs).toBe(77)
      expect(report.token.expiresInSec).toBe(1000)
    })
  })

  describe('rollup', () => {
    it('is healthy by default', () => {
      const m = makeReaders()
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })
      const result = collector.rollup(m.readers)
      expect(result.health).toBe('healthy')
      expect(result.reasons).toEqual([])
    })

    it('is degraded when the recent API error rate is high with enough samples', () => {
      const m = makeReaders()
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })
      // 6 errors out of 10 → 60% > 50% threshold.
      for (let i = 0; i < 6; i++) {
        collector.apiRequest(50, false)
      }
      for (let i = 0; i < 4; i++) {
        collector.apiRequest(50, true)
      }
      expect(collector.rollup(m.readers).reasons).toContain('apiErrorRateHigh')
    })

    it('treats exactly the threshold error rate as degraded (inclusive)', () => {
      const m = makeReaders()
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })
      // 5 errors out of 10 → exactly 50%, which meets the inclusive threshold.
      for (let i = 0; i < 5; i++) {
        collector.apiRequest(50, false)
      }
      for (let i = 0; i < 5; i++) {
        collector.apiRequest(50, true)
      }
      expect(collector.rollup(m.readers).reasons).toContain('apiErrorRateHigh')
    })

    it('ignores a high error rate below the minimum sample size', () => {
      const m = makeReaders()
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })
      collector.apiRequest(50, false)
      collector.apiRequest(50, false)
      expect(collector.rollup(m.readers).reasons).not.toContain('apiErrorRateHigh')
    })

    it('is degraded during a token refresh failure cooldown', () => {
      const m = makeReaders()
      m.tokenRefreshFailureActive.value = true
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })
      expect(collector.rollup(m.readers).reasons).toContain('tokenRefreshFailing')
    })

    it('is degraded when the last poll cycle failed every device', () => {
      const m = makeReaders()
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })
      collector.pollCycle(0, 2, 30)
      expect(collector.rollup(m.readers).reasons).toContain('pollingStalled')
    })

    it('is not degraded when a poll cycle had at least one success', () => {
      const m = makeReaders()
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })
      collector.pollCycle(1, 1, 30)
      expect(collector.rollup(m.readers).reasons).not.toContain('pollingStalled')
    })

    it('reports multiple simultaneous reasons', () => {
      const m = makeReaders()
      m.tokenRefreshFailureActive.value = true
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })
      collector.pollCycle(0, 1, 30)
      const result = collector.rollup(m.readers)
      expect(result.health).toBe('degraded')
      expect(result.reasons).toEqual(expect.arrayContaining(['tokenRefreshFailing', 'pollingStalled']))
    })

    it('flows the rollup health into heartbeat lifecycle', () => {
      const m = makeReaders()
      m.tokenRefreshFailureActive.value = true
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })
      const report = collector.buildHeartbeat(m.readers)
      expect(report.lifecycle.health).toBe('degraded')
      expect(report.lifecycle.reasons).toContain('tokenRefreshFailing')
    })
  })

  describe('snapshot', () => {
    it('reports session-cumulative totals without advancing the marker', () => {
      const m = makeReaders()
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })

      collector.stateChange()
      collector.stateChange()
      collector.apiRequest(10, true)

      const snap1 = collector.snapshot('diagnostics.start', m.readers)
      expect(snap1.msg).toBe('diagnostics.start')
      expect(snap1.activity.stateChanges).toBe(2)
      expect(snap1.api.requests).toBe(1)

      // Snapshots do not reset the marker — a heartbeat still sees the deltas.
      const beat = collector.buildHeartbeat(m.readers)
      expect(beat.activity.stateChanges).toBe(2)

      // A second snapshot remains cumulative.
      collector.stateChange()
      const snap2 = collector.snapshot('diagnostics.stop', m.readers)
      expect(snap2.activity.stateChanges).toBe(3)
    })

    it('includes a redacted config echo and never leaks credentials', () => {
      const m = makeReaders()
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })
      const snap = collector.snapshot('diagnostics.start', m.readers)

      expect(snap.config).toBeDefined()
      expect(snap.config).toMatchObject({
        diagnosticsInterval: 300,
        refreshRate: 120,
        structuredLogs: true,
        freezeThresholdCelsius: 2,
        devices: 2,
      })

      const serialized = JSON.stringify(snap)
      expect(serialized).not.toContain('super-secret-key')
      expect(serialized).not.toContain('super-secret-secret')
      expect(serialized).not.toContain('super-secret-access')
      expect(serialized).not.toContain('super-secret-refresh')
    })

    it('does not attach a config echo to heartbeats', () => {
      const m = makeReaders()
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })
      expect(collector.buildHeartbeat(m.readers).config).toBeUndefined()
    })
  })
})
