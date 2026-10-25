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

import {
  AuthenticationError,
  ConfigurationError,
  ForbiddenError,
  RefreshTokenInvalidError,
} from './errors'
import { PagerDutySignals } from './pagerduty-signals'
import type { PagerDutySignalsOptions, SignalState } from './pagerduty-signals'
import type { WaterLeakDetector } from './types'
import { isDeviceActive, isLeakDetected, isLowBattery } from './utils/mappers'

/** Logged once, in this order, when the setting is on. */
export const PAGERDUTY_STARTUP_LOG =
  'homebridge-pagerduty support is enabled (leak, detector-offline, low-battery, auth-failed, cloud-offline)'

export const SIGNAL_LEAK = 'leak'
export const SIGNAL_DETECTOR_OFFLINE = 'detector-offline'
export const SIGNAL_LOW_BATTERY = 'low-battery'
export const SIGNAL_AUTH_FAILED = 'auth-failed'
export const SIGNAL_CLOUD_OFFLINE = 'cloud-offline'

/** How long a detector body must stay absent before cloud-offline turns on. */
export const CLOUD_OFFLINE_GRACE_MS = 5 * 60 * 1000

/** How often to retry the cloud-offline write while that outage is still on. */
export const CLOUD_WRITE_RETRY_MS = 30 * 1000

export const LEAK_SUMMARY = 'A water leak detector is wet.'
export const DETECTOR_OFFLINE_SUMMARY = 'A water leak detector is offline.'
export const LOW_BATTERY_SUMMARY = 'A water leak detector battery is low.'
export const AUTH_REJECTED_SUMMARY =
  'Resideo rejected the account link. This plugin has stopped until the account is linked again in Homebridge.'
export const AUTH_FORBIDDEN_SUMMARY =
  'Resideo refused access for this developer app. This plugin has stopped until that app is allowed to see the detectors.'
export const AUTH_CREDENTIALS_SUMMARY =
  'Resideo rejected the API credentials. This plugin has stopped until the Consumer Key and Secret are corrected in Homebridge.'
export const CLOUD_OFFLINE_SUMMARY =
  'Homebridge has not reached Resideo for 5 minutes. Leak detector state in HomeKit may be stale.'

/** Why sign-in stopped. The summary depends on it. The signal name does not. */
export type SignInFailure = 'rejected' | 'forbidden' | 'credentials'

interface Reading {
  leak: boolean
  offline: boolean
  lowBattery: boolean
}

/** The subset of the store writer this class uses. */
export interface SignalWriter {
  write(signal: string, state: SignalState): void
  close(): void
}

/**
 * Classify an error for the auth-failed page.
 *
 * Undefined means the failure is not a stopped sign-in. A 401 the client is
 * about to refresh never arrives here. The AuthenticationError that does is
 * the one that remained after that refresh. RefreshTokenInvalidError is a
 * subclass, so it has to be named before the parent.
 */
export function signalFailureFrom(error: unknown): SignInFailure | undefined {
  if (error instanceof RefreshTokenInvalidError) {
    return 'rejected'
  }
  if (error instanceof ConfigurationError) {
    return 'credentials'
  }
  if (error instanceof ForbiddenError) {
    return 'forbidden'
  }
  if (error instanceof AuthenticationError) {
    return 'rejected'
  }
  return undefined
}

/**
 * House-level PagerDuty signals for the detectors this plugin is publishing.
 *
 * A body that says leak, offline, or low battery pages immediately. A clear
 * is written only when every detector still published has a body in the
 * current coverage set. An empty cloud list and a thrown read are not a
 * clear. Shutdown closes the writer and leaves every row as it was.
 */
export class ResideoSignals {
  readonly #writer: SignalWriter
  readonly #graceMs: number
  readonly #readings = new Map<string, Reading>()
  /** Detector ids whose current reading may justify a clear. */
  readonly #covered = new Set<string>()
  #offlineTimer: ReturnType<typeof setTimeout> | null = null
  #cloudRetry: ReturnType<typeof setTimeout> | null = null
  #isCloudOfflineConfirmed = false
  #isAuthRejected = false
  /** This poll saw a stopped sign-in. noteReached must not clear it. */
  #authLatched = false
  /** Kept so a clear writes the same sentence the page used. */
  #authFailure: SignInFailure = 'rejected'
  #hasStarted = false
  #isClosed = false

  constructor(writer: SignalWriter, graceMs = CLOUD_OFFLINE_GRACE_MS) {
    this.#writer = writer
    this.#graceMs = graceMs
  }

  /**
   * Start the offline grace.
   *
   * Does not write. Call once, before the first request, so an outage already
   * under way at launch still pages. Later failures do not push this timer out.
   */
  start(): void {
    if (this.#isClosed || this.#hasStarted) {
      return
    }
    this.#hasStarted = true
    this.#armOfflineGrace()
  }

  /**
   * Record one detector body that just arrived.
   *
   * Raises at once. Does not clear. A missing battery is not a low battery.
   * Omitted reachability fields are online, matching isDeviceActive.
   */
  observe(device: WaterLeakDetector): void {
    if (this.#isClosed || device.deviceID.length === 0) {
      return
    }
    const reading: Reading = {
      leak: isLeakDetected(device),
      offline: !isDeviceActive(device),
      lowBattery: isLowBattery(device.batteryRemaining),
    }
    this.#readings.set(device.deviceID, reading)
    this.#covered.add(device.deviceID)
    if (reading.leak) {
      this.#writeLeak(true)
    }
    if (reading.offline) {
      this.#writeOffline(true)
    }
    if (reading.lowBattery) {
      this.#writeBattery(true)
    }
  }

  /**
   * Raise from a body that arrived while a poll is already in flight.
   *
   * A true flag is stored and written. A false flag does not replace a true
   * one, and this does not mark the detector covered, so the in-flight poll
   * can still refuse a clear.
   */
  raiseOnly(device: WaterLeakDetector): void {
    if (this.#isClosed || device.deviceID.length === 0) {
      return
    }
    const next: Reading = {
      leak: isLeakDetected(device),
      offline: !isDeviceActive(device),
      lowBattery: isLowBattery(device.batteryRemaining),
    }
    const prior = this.#readings.get(device.deviceID)
    const reading: Reading = {
      leak: next.leak || prior?.leak === true,
      offline: next.offline || prior?.offline === true,
      lowBattery: next.lowBattery || prior?.lowBattery === true,
    }
    if (!reading.leak && !reading.offline && !reading.lowBattery) {
      return
    }
    this.#readings.set(device.deviceID, reading)
    if (next.leak) {
      this.#writeLeak(true)
    }
    if (next.offline) {
      this.#writeOffline(true)
    }
    if (next.lowBattery) {
      this.#writeBattery(true)
    }
  }

  /**
   * Start a poll.
   *
   * inherit keeps coverage from the locations list that just ran, so a GET
   * that throws still counts as the body that list already supplied. A later
   * poll does not inherit: a detector that was not read this cycle blocks the clear.
   */
  beginPoll(inherit: boolean): void {
    if (this.#isClosed) {
      return
    }
    this.#authLatched = false
    if (!inherit) {
      this.#covered.clear()
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
  settle(publishedIds: readonly string[]): void {
    if (this.#isClosed) {
      return
    }
    const published = new Set(publishedIds)
    for (const id of this.#readings.keys()) {
      if (!published.has(id)) {
        this.#readings.delete(id)
        this.#covered.delete(id)
      }
    }
    if (published.size === 0) {
      this.#writeHouse(false, false, false)
      return
    }
    for (const id of published) {
      if (!this.#covered.has(id)) {
        return
      }
    }
    let leak = false
    let offline = false
    let lowBattery = false
    for (const id of published) {
      const reading = this.#readings.get(id)
      if (!reading) {
        return
      }
      leak = leak || reading.leak
      offline = offline || reading.offline
      lowBattery = lowBattery || reading.lowBattery
    }
    this.#writeHouse(leak, offline, lowBattery)
  }

  /**
   * Drop one detector that left HomeKit and recompute.
   *
   * The remaining detectors keep their readings. A removed wet detector
   * clears the house leak once the others are covered.
   */
  release(deviceId: string, publishedIds: readonly string[]): void {
    this.#readings.delete(deviceId)
    this.#covered.delete(deviceId)
    this.settle(publishedIds)
  }

  /**
   * Sign-in has stopped.
   *
   * Cancels the outage grace and writes cloud-offline inactive. Does not
   * change leak, offline, or battery. Latched until a later cycle reaches
   * Resideo without another auth failure.
   */
  noteAuth(failure: SignInFailure): void {
    if (this.#isClosed) {
      return
    }
    this.#isAuthRejected = true
    this.#authLatched = true
    this.#authFailure = failure
    this.#isCloudOfflineConfirmed = false
    this.#clearOfflineTimer()
    this.#clearCloudRetry()
    this.#writeAuth(true)
    this.#writeCloud()
  }

  /**
   * A locations list or device poll reached Resideo.
   *
   * Ends the outage grace and writes cloud-offline inactive. Does not change
   * auth-failed. The poll that follows a locations list decides that.
   */
  noteCloudReached(): void {
    if (this.#isClosed) {
      return
    }
    this.#isCloudOfflineConfirmed = false
    this.#clearOfflineTimer()
    this.#clearCloudRetry()
    this.#writeCloud()
  }

  /**
   * This cycle reached Resideo and did not see a stopped sign-in.
   *
   * Clears auth and the outage grace. When auth is latched, the grace still
   * ends and cloud-offline stays off, and the auth page stays up.
   */
  noteReached(): void {
    if (this.#isClosed) {
      return
    }
    this.noteCloudReached()
    if (!this.#authLatched) {
      this.#isAuthRejected = false
      this.#writeAuth(false)
    }
  }

  /**
   * No detector body in this attempt.
   *
   * Arms the grace if it is not already running. Does not extend it, and
   * does nothing while auth-failed is on.
   */
  noteOutage(): void {
    if (this.#isClosed || this.#isAuthRejected) {
      return
    }
    this.#armOfflineGrace()
  }

  /** Close the store and stop the grace timer. Does not clear any signal. */
  close(): void {
    if (this.#isClosed) {
      return
    }
    this.#isClosed = true
    this.#clearOfflineTimer()
    this.#clearCloudRetry()
    this.#writer.close()
  }

  #writeHouse(leak: boolean, offline: boolean, lowBattery: boolean): void {
    this.#writeLeak(leak)
    this.#writeOffline(offline)
    this.#writeBattery(lowBattery)
  }

  #writeLeak(active: boolean): void {
    this.#writer.write(SIGNAL_LEAK, { active, severity: 'critical', summary: LEAK_SUMMARY })
  }

  #writeOffline(active: boolean): void {
    this.#writer.write(SIGNAL_DETECTOR_OFFLINE, {
      active,
      severity: 'error',
      summary: DETECTOR_OFFLINE_SUMMARY,
    })
  }

  #writeBattery(active: boolean): void {
    this.#writer.write(SIGNAL_LOW_BATTERY, {
      active,
      severity: 'warning',
      summary: LOW_BATTERY_SUMMARY,
    })
  }

  #writeAuth(active: boolean): void {
    const summary = this.#authFailure === 'forbidden'
      ? AUTH_FORBIDDEN_SUMMARY
      : this.#authFailure === 'credentials'
        ? AUTH_CREDENTIALS_SUMMARY
        : AUTH_REJECTED_SUMMARY
    this.#writer.write(SIGNAL_AUTH_FAILED, { active, severity: 'error', summary })
  }

  #writeCloud(): void {
    this.#writer.write(SIGNAL_CLOUD_OFFLINE, {
      active: this.#isCloudOfflineConfirmed && !this.#isAuthRejected,
      severity: 'error',
      summary: CLOUD_OFFLINE_SUMMARY,
    })
  }

  #armOfflineGrace(): void {
    if (this.#offlineTimer !== null || this.#isCloudOfflineConfirmed) {
      return
    }
    this.#offlineTimer = setTimeout(() => {
      this.#offlineTimer = null
      if (this.#isClosed || this.#isAuthRejected) {
        return
      }
      this.#isCloudOfflineConfirmed = true
      this.#writeCloud()
      this.#scheduleCloudRetry()
    }, this.#graceMs)
    this.#offlineTimer.unref?.()
  }

  #clearOfflineTimer(): void {
    if (this.#offlineTimer !== null) {
      clearTimeout(this.#offlineTimer)
      this.#offlineTimer = null
    }
  }

  /**
   * Try the cloud-offline write again while the outage is still on.
   *
   * The store writer skips a repeat once the row is in place, and retries the
   * sqlite write when the previous attempt never landed.
   */
  #scheduleCloudRetry(): void {
    if (this.#cloudRetry !== null || this.#isClosed) {
      return
    }
    this.#cloudRetry = setTimeout(() => {
      this.#cloudRetry = null
      if (this.#isClosed || !this.#isCloudOfflineConfirmed || this.#isAuthRejected) {
        return
      }
      this.#writeCloud()
      this.#scheduleCloudRetry()
    }, CLOUD_WRITE_RETRY_MS)
    this.#cloudRetry.unref?.()
  }

  #clearCloudRetry(): void {
    if (this.#cloudRetry !== null) {
      clearTimeout(this.#cloudRetry)
      this.#cloudRetry = null
    }
  }
}

/** Build the signals for this plugin, backed by the homebridge-pagerduty store. */
export function createResideoSignals(options: PagerDutySignalsOptions): ResideoSignals {
  return new ResideoSignals(new PagerDutySignals(options))
}
