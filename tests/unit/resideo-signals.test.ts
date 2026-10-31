/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview House-level signal policy: raise, clear, grace, and sign-in.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  ApiParseError,
  ApiResponseError,
  AuthenticationError,
  CircuitBreakerError,
  ConfigurationError,
  ForbiddenError,
  NetworkError,
  RateLimitError,
  RefreshTokenInvalidError,
  TimeoutError,
} from '../../src/errors'
import type { SignalState } from '../../src/pagerduty-signals'
import {
  AUTH_CREDENTIALS_SUMMARY,
  CLOUD_WRITE_RETRY_MS,
  AUTH_FORBIDDEN_SUMMARY,
  AUTH_REJECTED_SUMMARY,
  CLOUD_DEGRADED_MIN_DETECTORS,
  CLOUD_DEGRADED_SUMMARY,
  CLOUD_OFFLINE_GRACE_MS,
  CLOUD_OFFLINE_SUMMARY,
  DETECTOR_OFFLINE_SUMMARY,
  LEAK_SUMMARY,
  LOW_BATTERY_SUMMARY,
  ResideoSignals,
  SIGNAL_AUTH_FAILED,
  SIGNAL_CLOUD_OFFLINE,
  SIGNAL_DETECTOR_OFFLINE,
  SIGNAL_LEAK,
  SIGNAL_LOW_BATTERY,
  createResideoSignals,
  signalFailureFrom,
} from '../../src/resideo-signals'
import type { SignalWriter } from '../../src/resideo-signals'
import { LOW_BATTERY_THRESHOLD, PLUGIN_NAME } from '../../src/settings'
import type { WaterLeakDetector } from '../../src/types'

class MemoryWriter implements SignalWriter {
  readonly writes: Array<{ signal: string, state: SignalState }> = []
  closed = false

  write(signal: string, state: SignalState): void {
    this.writes.push({ signal, state: { ...state } })
  }

  close(): void {
    this.closed = true
  }

  last(signal: string): SignalState | undefined {
    for (let index = this.writes.length - 1; index >= 0; index--) {
      const write = this.writes[index]
      if (write?.signal === signal) {
        return write.state
      }
    }
    return undefined
  }
}

function detector(overrides: Partial<WaterLeakDetector> = {}): WaterLeakDetector {
  return {
    deviceID: 'dev-1',
    deviceClass: 'LeakDetector',
    deviceType: 'Water Leak Detector',
    waterPresent: false,
    userDefinedDeviceName: 'Utility room',
    ...overrides,
  }
}

describe('signalFailureFrom', () => {
  it.each([
    ['a rejected refresh token', new RefreshTokenInvalidError(), 'rejected'],
    ['a rejected access token', new AuthenticationError('rejected'), 'rejected'],
    ['a refused developer app', new ForbiddenError('refused'), 'forbidden'],
    ['rejected API credentials', new ConfigurationError('rejected key'), 'credentials'],
  ] as const)('pages %s', (_label, error, kind) => {
    expect(signalFailureFrom(error)).toBe(kind)
  })

  it.each([
    new ApiResponseError(404, 'missing'),
    new ApiResponseError(503, 'unavailable'),
    new RateLimitError('slow'),
    new NetworkError('down'),
    new TimeoutError('slow'),
    new ApiParseError('html'),
    new CircuitBreakerError(1_000),
    new Error('unexpected'),
    'nope',
  ])('does not page a failure that is not a stopped sign-in', (error) => {
    expect(signalFailureFrom(error)).toBeUndefined()
  })
})

describe('ResideoSignals', () => {
  let writer: MemoryWriter
  let signals: ResideoSignals

  beforeEach(() => {
    jest.useFakeTimers()
    writer = new MemoryWriter()
    signals = new ResideoSignals(writer)
  })

  afterEach(() => {
    signals.close()
    jest.useRealTimers()
  })

  it('arms a five-minute grace at start and writes nothing until it elapses', () => {
    expect(CLOUD_OFFLINE_GRACE_MS).toBe(5 * 60 * 1000)
    signals.start()
    expect(writer.writes).toEqual([])

    jest.advanceTimersByTime(CLOUD_OFFLINE_GRACE_MS - 1)
    expect(writer.last(SIGNAL_CLOUD_OFFLINE)).toBeUndefined()

    jest.advanceTimersByTime(1)
    expect(writer.last(SIGNAL_CLOUD_OFFLINE)).toEqual({
      active: true,
      severity: 'error',
      summary: CLOUD_OFFLINE_SUMMARY,
    })
  })

  it('does not extend a grace that is already running', () => {
    signals.start()
    jest.advanceTimersByTime(4 * 60 * 1000)
    signals.noteOutage()
    jest.advanceTimersByTime(60 * 1000)

    expect(writer.last(SIGNAL_CLOUD_OFFLINE)?.active).toBe(true)
  })

  it('starts a new five minutes after a body arrives', () => {
    signals.start()
    signals.noteReached()
    jest.advanceTimersByTime(CLOUD_OFFLINE_GRACE_MS)
    expect(writer.last(SIGNAL_CLOUD_OFFLINE)?.active).toBe(false)

    signals.noteOutage()
    jest.advanceTimersByTime(CLOUD_OFFLINE_GRACE_MS - 1)
    expect(writer.last(SIGNAL_CLOUD_OFFLINE)?.active).toBe(false)
    jest.advanceTimersByTime(1)
    expect(writer.last(SIGNAL_CLOUD_OFFLINE)?.active).toBe(true)
  })

  it('does not restart the grace when start is called twice', () => {
    signals.start()
    jest.advanceTimersByTime(CLOUD_OFFLINE_GRACE_MS - 1)
    signals.start()
    jest.advanceTimersByTime(1)

    expect(writer.last(SIGNAL_CLOUD_OFFLINE)?.active).toBe(true)
  })

  it('raises from one body and keeps the detector name out of the summary', () => {
    signals.observe(detector({
      waterPresent: true,
      isAlive: false,
      batteryRemaining: LOW_BATTERY_THRESHOLD,
    }))
    expect(writer.last(SIGNAL_DETECTOR_OFFLINE)).toBeUndefined()
    signals.settle(['dev-1'])

    expect(writer.last(SIGNAL_LEAK)).toEqual({
      active: true,
      severity: 'critical',
      summary: LEAK_SUMMARY,
    })
    expect(writer.last(SIGNAL_DETECTOR_OFFLINE)).toEqual({
      active: true,
      severity: 'error',
      summary: DETECTOR_OFFLINE_SUMMARY,
    })
    expect(writer.last(SIGNAL_LOW_BATTERY)).toEqual({
      active: true,
      severity: 'warning',
      summary: LOW_BATTERY_SUMMARY,
    })
    expect(JSON.stringify(writer.writes)).not.toContain('Utility room')
    expect(JSON.stringify(writer.writes)).not.toContain('dev-1')
  })

  it('treats a missing battery and omitted reachability as clear', () => {
    signals.observe(detector({ batteryRemaining: Number.NaN }))
    signals.settle(['dev-1'])

    expect(writer.last(SIGNAL_LEAK)?.active).toBe(false)
    expect(writer.last(SIGNAL_DETECTOR_OFFLINE)?.active).toBe(false)
    expect(writer.last(SIGNAL_LOW_BATTERY)?.active).toBe(false)
  })

  it.each([
    ['is offline', { isDeviceOffline: true }],
    ['has not checked in', { hasDeviceCheckedIn: false }],
    ['is not alive', { isAlive: false }],
  ])('pages a detector that %s', (_label, fields) => {
    signals.observe(detector(fields))
    signals.settle(['dev-1'])
    expect(writer.last(SIGNAL_DETECTOR_OFFLINE)?.active).toBe(true)
  })

  it('does not page offline for a body still inside the hold, but still pages its leak', () => {
    signals.observe(detector({ isAlive: false, waterPresent: true }), true)
    signals.settle(['dev-1'])

    expect(writer.last(SIGNAL_DETECTOR_OFFLINE)?.active).toBe(false)
    expect(writer.last(SIGNAL_LEAK)?.active).toBe(true)
  })

  it('pages cloud-offline instead of detector-offline when every detector is offline', () => {
    signals.observe(detector({ deviceID: 'a', isAlive: false }))
    signals.observe(detector({ deviceID: 'b', isDeviceOffline: true }))
    signals.settle(['a', 'b'])

    expect(writer.last(SIGNAL_DETECTOR_OFFLINE)?.active).toBe(false)
    expect(writer.last(SIGNAL_CLOUD_OFFLINE)).toEqual({
      active: true,
      severity: 'error',
      summary: CLOUD_DEGRADED_SUMMARY,
    })

    signals.beginPoll(false)
    signals.observe(detector({ deviceID: 'a' }))
    signals.observe(detector({ deviceID: 'b', isDeviceOffline: true }))
    signals.settle(['a', 'b'])

    expect(writer.last(SIGNAL_DETECTOR_OFFLINE)?.active).toBe(true)
    expect(writer.last(SIGNAL_CLOUD_OFFLINE)).toEqual({
      active: false,
      severity: 'error',
      summary: CLOUD_DEGRADED_SUMMARY,
    })
  })

  it('treats a lone offline detector as a detector problem, not a cloud problem', () => {
    expect(CLOUD_DEGRADED_MIN_DETECTORS).toBe(2)
    signals.observe(detector({ deviceID: 'a', isAlive: false }))
    signals.settle(['a'])

    expect(writer.last(SIGNAL_DETECTOR_OFFLINE)?.active).toBe(true)
    expect(writer.last(SIGNAL_CLOUD_OFFLINE)).toBeUndefined()
  })

  it('keeps the unreachable summary when Resideo stops answering during an all-offline report', () => {
    signals.start()
    signals.observe(detector({ deviceID: 'a', isAlive: false }))
    signals.observe(detector({ deviceID: 'b', isAlive: false }))
    signals.settle(['a', 'b'])
    jest.advanceTimersByTime(CLOUD_OFFLINE_GRACE_MS)

    expect(writer.last(SIGNAL_CLOUD_OFFLINE)).toEqual({
      active: true,
      severity: 'error',
      summary: CLOUD_OFFLINE_SUMMARY,
    })
  })

  it('does not page cloud-offline for an all-offline report while sign-in has stopped', () => {
    signals.noteAuth('rejected')
    signals.observe(detector({ deviceID: 'a', isAlive: false }))
    signals.observe(detector({ deviceID: 'b', isAlive: false }))
    signals.settle(['a', 'b'])

    expect(writer.last(SIGNAL_CLOUD_OFFLINE)?.active).toBe(false)
  })

  it('does not page a battery above the threshold', () => {
    signals.observe(detector({ batteryRemaining: LOW_BATTERY_THRESHOLD + 1 }))
    signals.settle(['dev-1'])
    expect(writer.last(SIGNAL_LOW_BATTERY)?.active).toBe(false)
  })

  it('pages when any published detector is wet, offline, or low, and clears only when all are covered', () => {
    signals.observe(detector({ deviceID: 'a', waterPresent: true, batteryRemaining: 90 }))
    signals.observe(detector({ deviceID: 'b', waterPresent: false, batteryRemaining: LOW_BATTERY_THRESHOLD }))
    signals.settle(['a', 'b'])

    expect(writer.last(SIGNAL_LEAK)?.active).toBe(true)
    expect(writer.last(SIGNAL_LOW_BATTERY)?.active).toBe(true)

    signals.beginPoll(false)
    signals.observe(detector({ deviceID: 'b', waterPresent: false, batteryRemaining: 90 }))
    signals.settle(['a', 'b'])
    expect(writer.last(SIGNAL_LEAK)?.active).toBe(true)

    signals.observe(detector({
      deviceID: 'a',
      waterPresent: false,
      batteryRemaining: 90,
      isAlive: true,
      isDeviceOffline: false,
      hasDeviceCheckedIn: true,
    }))
    signals.settle(['a', 'b'])
    expect(writer.last(SIGNAL_LEAK)?.active).toBe(false)
    expect(writer.last(SIGNAL_LOW_BATTERY)?.active).toBe(false)
    expect(writer.last(SIGNAL_DETECTOR_OFFLINE)?.active).toBe(false)
  })

  it('lets one wet body raise while an omitted id blocks the clear', () => {
    signals.observe(detector({ deviceID: 'a', waterPresent: true }))
    signals.settle(['a', 'pending'])

    expect(writer.last(SIGNAL_LEAK)?.active).toBe(true)
  })

  it('keeps the locations body when the following poll inherits and the GET does not return', () => {
    signals.observe(detector({ deviceID: 'a', waterPresent: true }))
    signals.observe(detector({ deviceID: 'b', waterPresent: false }))
    signals.beginPoll(true)
    signals.observe(detector({ deviceID: 'b', waterPresent: false }))
    signals.settle(['a', 'b'])

    expect(writer.last(SIGNAL_LEAK)?.active).toBe(true)
  })

  it('does not let a later poll clear from a detector it did not read', () => {
    signals.observe(detector({ deviceID: 'a', waterPresent: true }))
    signals.observe(detector({ deviceID: 'b', waterPresent: false }))
    signals.settle(['a', 'b'])
    signals.beginPoll(false)
    signals.observe(detector({ deviceID: 'b', waterPresent: false }))
    signals.settle(['a', 'b'])

    expect(writer.last(SIGNAL_LEAK)?.active).toBe(true)
  })

  it('clears when the last published detector is removed', () => {
    signals.observe(detector({ deviceID: 'a', waterPresent: true }))
    signals.settle([])

    expect(writer.last(SIGNAL_LEAK)?.active).toBe(false)
    expect(writer.last(SIGNAL_DETECTOR_OFFLINE)?.active).toBe(false)
    expect(writer.last(SIGNAL_LOW_BATTERY)?.active).toBe(false)
  })

  it('clears a removed wet detector when the ones still published are covered and dry', () => {
    signals.observe(detector({ deviceID: 'a', waterPresent: true }))
    signals.observe(detector({ deviceID: 'b', waterPresent: false }))
    signals.release('a', ['b'])

    expect(writer.last(SIGNAL_LEAK)?.active).toBe(false)
  })

  it('does not clear when the detector that remains was not part of this read', () => {
    signals.observe(detector({ deviceID: 'a', waterPresent: true }))
    signals.beginPoll(false)
    signals.release('a', ['b'])

    expect(writer.last(SIGNAL_LEAK)?.active).toBe(true)
  })

  it('ignores a body with no device id', () => {
    signals.observe(detector({ deviceID: '', waterPresent: true }))
    expect(writer.writes).toEqual([])
  })

  it.each([
    ['rejected', 'rejected' as const, AUTH_REJECTED_SUMMARY],
    ['forbidden', 'forbidden' as const, AUTH_FORBIDDEN_SUMMARY],
    ['credentials', 'credentials' as const, AUTH_CREDENTIALS_SUMMARY],
  ])('pages a %s sign-in and holds cloud-offline off', (_label, failure, summary) => {
    signals.start()
    signals.observe(detector({ waterPresent: true }))
    signals.noteAuth(failure)
    jest.advanceTimersByTime(CLOUD_OFFLINE_GRACE_MS)
    signals.noteOutage()
    jest.advanceTimersByTime(CLOUD_OFFLINE_GRACE_MS)

    expect(writer.last(SIGNAL_AUTH_FAILED)).toEqual({
      active: true,
      severity: 'error',
      summary,
    })
    expect(writer.last(SIGNAL_CLOUD_OFFLINE)?.active).toBe(false)
    expect(writer.last(SIGNAL_LEAK)?.active).toBe(true)
  })

  it('keeps auth up when this cycle already saw a stopped sign-in, and clears it on the next one', () => {
    signals.noteAuth('forbidden')
    signals.noteReached()
    expect(writer.last(SIGNAL_AUTH_FAILED)?.active).toBe(true)
    expect(writer.last(SIGNAL_CLOUD_OFFLINE)?.active).toBe(false)

    signals.beginPoll(false)
    signals.noteReached()
    expect(writer.last(SIGNAL_AUTH_FAILED)).toEqual({
      active: false,
      severity: 'error',
      summary: AUTH_FORBIDDEN_SUMMARY,
    })
  })

  it('closes the store without clearing a signal or letting the grace fire', () => {
    signals.start()
    signals.observe(detector({ waterPresent: true }))
    const written = writer.writes.length
    signals.close()

    jest.advanceTimersByTime(CLOUD_OFFLINE_GRACE_MS)
    signals.beginPoll(false)
    signals.observe(detector({ waterPresent: false }))
    signals.noteReached()
    signals.noteAuth('rejected')
    signals.noteOutage()
    signals.settle([])

    expect(writer.closed).toBe(true)
    expect(writer.writes).toHaveLength(written)
    expect(writer.last(SIGNAL_LEAK)?.active).toBe(true)
  })

  it('does not let a locations body clear auth-failed', () => {
    signals.noteAuth('rejected')
    signals.noteCloudReached()

    expect(writer.last(SIGNAL_AUTH_FAILED)?.active).toBe(true)
    expect(writer.last(SIGNAL_CLOUD_OFFLINE)?.active).toBe(false)
  })

  it('does not let a later locations body clear a leak a poll already saw', () => {
    signals.observe(detector({ deviceID: 'a', waterPresent: true }))
    signals.raiseOnly(detector({ deviceID: 'a', waterPresent: false }))
    signals.settle(['a'])

    expect(writer.last(SIGNAL_LEAK)?.active).toBe(true)
  })

  it('raises from a locations body that arrives during a poll without covering it', () => {
    signals.observe(detector({ deviceID: 'a', waterPresent: false }))
    signals.raiseOnly(detector({ deviceID: 'b', waterPresent: true, userDefinedDeviceName: 'Kitchen' }))
    signals.settle(['a', 'b'])

    expect(writer.last(SIGNAL_LEAK)?.active).toBe(true)
    expect(JSON.stringify(writer.writes)).not.toContain('Kitchen')
  })

  it('retries the cloud-offline write while the outage continues, and stops after a body arrives', () => {
    signals.start()
    jest.advanceTimersByTime(CLOUD_OFFLINE_GRACE_MS)
    const activeWrites = (): number => writer.writes
      .filter(write => write.signal === SIGNAL_CLOUD_OFFLINE && write.state.active)
      .length
    const afterGrace = activeWrites()
    expect(afterGrace).toBe(1)

    jest.advanceTimersByTime(CLOUD_WRITE_RETRY_MS)
    expect(activeWrites()).toBe(afterGrace + 1)

    signals.noteReached()
    const afterReached = writer.writes.length
    jest.advanceTimersByTime(CLOUD_WRITE_RETRY_MS * 2)
    expect(writer.writes).toHaveLength(afterReached)
    expect(writer.last(SIGNAL_CLOUD_OFFLINE)?.active).toBe(false)
  })

  it('creates no store file until a signal is written', () => {
    const storagePath = mkdtempSync(join(tmpdir(), 'myresideo-signals-'))
    try {
      const created = createResideoSignals({
        plugin: PLUGIN_NAME,
        storagePath,
        log: { warn: jest.fn() },
      })
      created.start()
      created.close()
      expect(existsSync(join(storagePath, 'homebridge-pagerduty'))).toBe(false)
    } finally {
      rmSync(storagePath, { recursive: true, force: true })
    }
  })
})
