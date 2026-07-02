/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Homebridge dynamic platform for Resideo / Honeywell Home
 * WiFi Water Leak & Freeze Detectors.
 */

import { promises as fs } from 'node:fs'

import type {
  API,
  Characteristic as CharacteristicClass,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  Service as ServiceClass,
} from 'homebridge'

import { ResideoApiClient, TokenManager } from './api'
import { LeakSensorAccessory } from './devices/leak-sensor'
import { DiagnosticsCollector } from './diagnostics/collector'
import type { DiagnosticsReaders } from './diagnostics/collector'
import {
  ApiParseError,
  ApiResponseError,
  AuthenticationError,
  ConfigurationError,
  ForbiddenError,
  RefreshTokenInvalidError,
} from './errors'
import {
  DEFAULT_REFRESH_RATE_SEC,
  INITIAL_DISCOVERY_RETRY_MS,
  MAX_DISCOVERY_RETRY_MS,
  MIN_DIAGNOSTICS_INTERVAL_SEC,
  MIN_REFRESH_RATE_SEC,
  PLATFORM_NAME,
  PLUGIN_NAME,
  POLL_DEVICE_CONCURRENCY,
  TOKEN_REFRESH_FAILURE_COOLDOWN_MS,
  UUID_PREFIX,
} from './settings'
import type {
  DeviceGauges,
  DiagnosticsSnapshot,
  LeakDetectorOptions,
  ResideoPlatformConfig,
  WaterLeakDetector,
} from './types'
import {
  describeDeviceState,
  hasActiveAlarms,
  isDeviceActive,
  isLeakDetected,
  isLowBattery,
  isWaterLeakDetector,
  maskToken,
  sanitizeError,
  sanitizeFreezeThreshold,
  validateConfig,
} from './utils'

/**
 * Installed plugin version, used for diagnostics lifecycle reporting.
 *
 * Resolved via `require` rather than a static `import`: `package.json` lives
 * outside the TypeScript `rootDir` (`src/`), so importing it would alter the
 * emitted `dist/` layout. The require resolves correctly from both the compiled
 * `dist/` output and ts-jest.
 */
function readPluginVersion(): string {
  try {
    return (require('../package.json').version as string) || 'unknown'
  } catch {
    return 'unknown'
  }
}

const PLUGIN_VERSION = readPluginVersion()

export default class ResideoPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof ServiceClass
  public readonly Characteristic: typeof CharacteristicClass
  public readonly accessories: PlatformAccessory[] = []

  private readonly config: ResideoPlatformConfig
  private readonly handlers = new Map<string, LeakSensorAccessory>()
  private readonly locationByDevice = new Map<string, number>()
  /** Device IDs whose one-line boot state summary has already been logged, so a
   *  discovery retry that re-registers the same detectors does not re-log it. */
  private readonly bootSummaryLogged = new Set<string>()

  private tokenManager?: TokenManager
  private client?: ResideoApiClient
  private pollTimer?: ReturnType<typeof setInterval>
  private discoveryTimer?: ReturnType<typeof setTimeout>
  private discoveryAttempt = 0
  private isPolling = false
  private stopped = false
  /** True when startup validation failed; the platform stays inert. */
  private disabled = false

  // Opt-in diagnostics subsystem (off unless options.diagnosticsInterval > 0).
  private diagnostics?: DiagnosticsCollector
  private diagnosticsTimer?: ReturnType<typeof setInterval>
  private lastDiagnosticsHealth: 'healthy' | 'degraded' | null = null
  /** Detectors returned by Resideo at the last successful discovery. */
  private lastCloudDetectorCount = 0
  /** Epoch ms of the last failed token refresh, for the degraded-health window. */
  private lastRefreshFailureAt: number | null = null

  constructor(
    public readonly log: Logging,
    config: ResideoPlatformConfig,
    private readonly api: API,
  ) {
    this.Service = api.hap.Service
    this.Characteristic = api.hap.Characteristic
    this.config = config

    const { errors, warnings } = validateConfig(config)
    for (const warning of warnings) {
      this.log.warn(warning)
    }
    if (errors.length > 0) {
      for (const error of errors) {
        this.log.error(error)
      }
      this.log.error('Invalid configuration; plugin will not start until it is corrected.')
      this.disabled = true
      return
    }

    this.log.info(`Initializing ${this.config.name ?? PLATFORM_NAME} platform`)

    // The collector is created before the client/token manager so their metric
    // hooks can feed it. It is cheap and purely in-memory; nothing is emitted
    // to the log unless options.diagnosticsInterval > 0.
    this.diagnostics = new DiagnosticsCollector({ pluginVersion: PLUGIN_VERSION, config })

    this.tokenManager = new TokenManager({
      consumerKey: config.credentials.consumerKey,
      consumerSecret: config.credentials.consumerSecret,
      refreshToken: config.credentials.refreshToken,
      accessToken: config.credentials.accessToken,
      logger: this.log,
      onRefreshToken: token => this.persistRefreshToken(token),
      onRefreshSuccess: () => {
        this.lastRefreshFailureAt = null
        this.diagnostics?.tokenRefresh()
      },
      onRefreshFailure: () => {
        this.lastRefreshFailureAt = Date.now()
      },
    })

    this.client = new ResideoApiClient({
      tokenManager: this.tokenManager,
      apikey: config.credentials.consumerKey,
      logger: this.log,
      metrics: sample => this.diagnostics?.apiRequest(sample.durationMs, sample.ok),
      onRetry: () => this.diagnostics?.retry(),
    })

    this.api.on('didFinishLaunching', () => {
      void this.discoverDevices()
    })
    this.api.on('shutdown', () => {
      this.stopped = true
      this.stopDiagnostics()
      if (this.pollTimer) {
        clearInterval(this.pollTimer)
      }
      if (this.discoveryTimer) {
        clearTimeout(this.discoveryTimer)
      }
    })
  }

  /**
   * Record a device state transition (leak/offline/battery/freeze) for the
   * diagnostics activity counter. Called by the accessory handlers. The collector
   * accumulates counters whenever the platform is active (regardless of
   * `diagnosticsInterval`); only emission to the log is gated on the interval, so
   * this is a no-op only when the platform was disabled by invalid config.
   */
  recordStateChange(): void {
    this.diagnostics?.stateChange()
  }

  /** Restore an accessory from the Homebridge cache. */
  configureAccessory(accessory: PlatformAccessory): void {
    if (this.disabled) {
      this.log.debug(
        `Platform disabled by invalid config; cached accessory "${accessory.displayName}" will not be updated.`,
      )
    }
    this.accessories.push(accessory)
  }

  private get refreshRateMs(): number {
    // A non-numeric/NaN refreshRate (e.g. a stray string in config.json) must
    // never reach setInterval: Math.max(NaN, min) is NaN, which setInterval
    // coerces to 0 and would hammer the API. Fall back to the default instead.
    const configured = this.config.options?.refreshRate
    const seconds = typeof configured === 'number' && !Number.isNaN(configured)
      ? configured
      : DEFAULT_REFRESH_RATE_SEC
    return Math.max(seconds, MIN_REFRESH_RATE_SEC) * 1000
  }

  private async discoverDevices(): Promise<void> {
    if (!this.client || this.stopped) {
      return
    }
    try {
      const locations = await this.client.getLocations()
      // The await above can span a shutdown; if so, stop before wiring anything
      // up (registering accessories or starting a poll timer that nothing clears).
      if (this.stopped) {
        return
      }
      const detectors: Array<{ device: WaterLeakDetector, locationId: number }> = []
      for (const location of locations) {
        for (const device of location.devices ?? []) {
          if (isWaterLeakDetector(device)) {
            detectors.push({ device, locationId: location.locationID })
          }
        }
      }

      this.log.info(`Discovered ${detectors.length} water leak detector(s)`)
      this.lastCloudDetectorCount = detectors.length
      for (const { device, locationId } of detectors) {
        this.registerDevice(device, locationId)
      }

      this.pruneStaleAccessories(new Set(detectors.map(d => d.device.deviceID)))

      this.discoveryAttempt = 0
      await this.runPollCycle()
      this.startPolling()
      this.startDiagnostics()
    } catch (err) {
      this.handleError('discoverDevices', err)
      if (this.isFatal(err)) {
        this.log.error('Discovery failed with a non-recoverable error; not retrying automatically.')
        return
      }
      this.scheduleDiscoveryRetry()
    }
  }

  /**
   * Errors that retrying discovery cannot resolve, so we stop instead of
   * looping the capped backoff forever and spamming the log. This covers bad
   * credentials/re-link conditions ({@link AuthenticationError} and its
   * {@link RefreshTokenInvalidError} subclass, {@link ConfigurationError}), a
   * permissions problem ({@link ForbiddenError}), an unparseable/unexpected
   * payload ({@link ApiParseError}), and any non-retryable HTTP response such
   * as a 404 ({@link ApiResponseError} with `isRetryable === false`). Transient
   * 5xx/network/timeout errors remain retryable.
   */
  private isFatal(err: unknown): boolean {
    if (err instanceof AuthenticationError
      || err instanceof ConfigurationError
      || err instanceof ForbiddenError
      || err instanceof ApiParseError) {
      return true
    }
    if (err instanceof ApiResponseError) {
      return !err.isRetryable
    }
    return false
  }

  /**
   * Retry discovery with capped exponential backoff so a transient outage at
   * boot doesn't leave the plugin permanently inert until a manual restart.
   */
  private scheduleDiscoveryRetry(): void {
    if (this.stopped) {
      return
    }
    this.discoveryAttempt++
    const wait = Math.min(
      INITIAL_DISCOVERY_RETRY_MS * 2 ** (this.discoveryAttempt - 1),
      MAX_DISCOVERY_RETRY_MS,
    )
    this.log.warn(`Retrying device discovery in ${Math.round(wait / 1000)}s (attempt ${this.discoveryAttempt})`)
    this.discoveryTimer = setTimeout(() => {
      void this.discoverDevices()
    }, wait)
  }

  private registerDevice(device: WaterLeakDetector, locationId: number): void {
    const rawOptions = this.optionsForDevice(device.deviceID)
    // Drop out-of-range/non-numeric thresholds here so the device's own limit
    // (or the plugin default) is used, matching what validateConfig warns about.
    const options: LeakDetectorOptions = {
      ...rawOptions,
      freezeThresholdCelsius: sanitizeFreezeThreshold(rawOptions.freezeThresholdCelsius),
    }
    const defaultFreezeThreshold = sanitizeFreezeThreshold(this.config.options?.freezeThresholdCelsius)
    const displayName = options.name || device.userDefinedDeviceName || 'Water Leak Detector'
    const uuid = this.api.hap.uuid.generate(`${UUID_PREFIX}${device.deviceID}`)
    this.locationByDevice.set(device.deviceID, locationId)

    let accessory = this.accessories.find(a => a.UUID === uuid)
    if (accessory) {
      accessory.context.device = device
      // Keep the cached accessory's name in step with a changed config/device name.
      accessory.displayName = displayName
      this.api.updatePlatformAccessories([accessory])
    } else {
      accessory = new this.api.platformAccessory(displayName, uuid)
      accessory.context.device = device
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
      this.log.info(`Registered new water leak detector: ${displayName}`)
    }

    const handler = new LeakSensorAccessory(this, accessory, options, defaultFreezeThreshold)
    this.handlers.set(device.deviceID, handler)

    // One-line state summary at boot so the log shows each detector's condition,
    // not just the discovered count. Healthy devices read calmly; problems are
    // capitalized in the summary so they stand out (see describeDeviceState). Logged
    // once per device (the accessory establishes its baseline silently, so this is
    // the single startup state report) and never re-logged on a discovery retry.
    if (!this.bootSummaryLogged.has(device.deviceID)) {
      this.bootSummaryLogged.add(device.deviceID)
      const summary = `${displayName}: ${describeDeviceState(device, options, defaultFreezeThreshold)}`
      // A leak or active alarm at startup is an actionable condition, so surface it
      // at warn (matching the prior first-poll behavior); routine state stays info.
      if (isLeakDetected(device) || hasActiveAlarms(device)) {
        this.log.warn(summary)
      } else {
        this.log.info(summary)
      }
    }
  }

  /** Unregister cached accessories that are no longer present in the account. */
  private pruneStaleAccessories(currentDeviceIds: Set<string>): void {
    const stale = this.accessories.filter((accessory) => {
      const id = (accessory.context.device as WaterLeakDetector | undefined)?.deviceID
      return id !== undefined && id !== '' && !currentDeviceIds.has(id)
    })
    if (stale.length === 0) {
      return
    }

    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale)
    for (const accessory of stale) {
      const index = this.accessories.indexOf(accessory)
      if (index !== -1) {
        this.accessories.splice(index, 1)
      }
      const device = accessory.context.device as WaterLeakDetector | undefined
      if (device?.deviceID) {
        this.handlers.delete(device.deviceID)
        this.locationByDevice.delete(device.deviceID)
        // Forget the boot-summary marker so a detector that later returns to the
        // account is reported again rather than being silently re-added.
        this.bootSummaryLogged.delete(device.deviceID)
      }
      this.log.info(`Removed stale water leak detector: ${accessory.displayName}`)
    }
  }

  private optionsForDevice(deviceID: string): LeakDetectorOptions {
    const override = this.config.options?.devices?.find(d => d.deviceID === deviceID)
    return override ?? { deviceID }
  }

  private startPolling(): void {
    if (this.stopped) {
      return
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
    }
    this.pollTimer = setInterval(() => {
      void this.runPollCycle()
    }, this.refreshRateMs)
  }

  /** Run one poll cycle, skipping if a previous cycle is still in flight. */
  private async runPollCycle(): Promise<void> {
    if (this.stopped) {
      return
    }
    if (this.isPolling) {
      this.log.debug('Skipping poll tick; previous cycle still running')
      return
    }
    this.isPolling = true
    const cycleStart = Date.now()
    try {
      const { ok, failed } = await this.pollAll()
      this.diagnostics?.pollCycle(ok, failed, Date.now() - cycleStart)
    } finally {
      this.isPolling = false
    }
  }

  /**
   * Poll every device with bounded concurrency so cycle time stays bounded.
   * Returns per-cycle success/failure counts for diagnostics.
   */
  private async pollAll(): Promise<{ ok: number, failed: number }> {
    if (!this.client) {
      return { ok: 0, failed: 0 }
    }
    // Snapshot the device IDs that currently have a known location. Each worker
    // re-checks per device below, since pruning/discovery can mutate the maps
    // while a cycle is in flight.
    const deviceIds = [...this.handlers.keys()].filter(id => this.locationByDevice.has(id))
    const workerCount = Math.min(POLL_DEVICE_CONCURRENCY, deviceIds.length)
    if (workerCount === 0) {
      return { ok: 0, failed: 0 }
    }

    let nextIndex = 0
    let ok = 0
    let failed = 0
    const worker = async (): Promise<void> => {
      while (nextIndex < deviceIds.length) {
        const deviceID = deviceIds[nextIndex++]
        const locationId = this.locationByDevice.get(deviceID)
        const handler = this.handlers.get(deviceID)
        if (locationId === undefined || !handler || !this.client) {
          continue
        }
        const startedAt = Date.now()
        try {
          const device = await this.client.getWaterLeakDetector(deviceID, locationId)
          handler.updateStatus(device, Date.now() - startedAt)
          ok++
        } catch (err) {
          failed++
          this.handleError(`poll ${deviceID}`, err)
        }
      }
    }

    await Promise.all(Array.from({ length: workerCount }, () => worker()))
    return { ok, failed }
  }

  private handleError(context: string, err: unknown): void {
    if (err instanceof RefreshTokenInvalidError) {
      this.log.error(`[${context}] Refresh token invalid. Re-link your account in the plugin settings.`)
      return
    }
    if (err instanceof ConfigurationError) {
      this.log.error(`[${context}] ${err.message}`)
      return
    }
    this.log.error(`[${context}] ${sanitizeError(err)}`)
  }

  /** Diagnostics heartbeat interval in milliseconds (0 when disabled). */
  private diagnosticsIntervalMs(): number {
    const seconds = this.config.options?.diagnosticsInterval
    if (typeof seconds !== 'number' || Number.isNaN(seconds) || seconds <= 0) {
      return 0
    }
    return Math.max(seconds, MIN_DIAGNOSTICS_INTERVAL_SEC) * 1000
  }

  /** Effective polling cadence in seconds (mirrors refreshRateMs clamping). */
  private pollingCadenceSeconds(): number {
    return Math.round(this.refreshRateMs / 1000)
  }

  /**
   * Start the diagnostics subsystem: emit the boot snapshot and schedule the
   * heartbeat. No-op unless options.diagnosticsInterval > 0. Diagnostics must
   * never be able to crash the host, so emission is wrapped defensively.
   */
  private startDiagnostics(): void {
    const interval = this.diagnosticsIntervalMs()
    if (interval <= 0 || this.stopped || this.diagnosticsTimer || !this.diagnostics) {
      return
    }
    try {
      const startReport = this.diagnostics.snapshot('diagnostics.start', this.buildDiagnosticsReaders())
      this.lastDiagnosticsHealth = startReport.lifecycle.health
      this.emitDiagnostic('info', startReport)
    } catch (err) {
      this.log.debug(`Failed to emit diagnostics start snapshot: ${sanitizeError(err)}`)
    }
    this.diagnosticsTimer = setInterval(() => this.diagnosticsHeartbeat(), interval)
  }

  /** Emit the cumulative stop snapshot and tear down the heartbeat timer. */
  private stopDiagnostics(): void {
    if (!this.diagnosticsTimer) {
      return
    }
    try {
      this.emitDiagnostic('info', this.diagnostics!.snapshot('diagnostics.stop', this.buildDiagnosticsReaders()))
    } catch (err) {
      this.log.debug(`Failed to emit diagnostics stop snapshot: ${sanitizeError(err)}`)
    }
    clearInterval(this.diagnosticsTimer)
    this.diagnosticsTimer = undefined
  }

  /**
   * Emit a single heartbeat (per-interval deltas) and log health transitions.
   * Wrapped so a reader failure can never escape the timer and crash Homebridge.
   */
  private diagnosticsHeartbeat(): void {
    if (!this.diagnostics) {
      return
    }
    try {
      const report = this.diagnostics.buildHeartbeat(this.buildDiagnosticsReaders())
      this.emitDiagnostic('info', report)

      const health = report.lifecycle.health
      if (this.lastDiagnosticsHealth !== null && health !== this.lastDiagnosticsHealth) {
        const isDegraded = health === 'degraded'
        this.emitDiagnostic(isDegraded ? 'warn' : 'info', {
          ...report,
          msg: isDegraded ? 'health.degraded' : 'health.recovered',
        }, { concise: true })
      }
      this.lastDiagnosticsHealth = health
    } catch (err) {
      this.log.debug(`Diagnostics heartbeat failed: ${sanitizeError(err)}`)
    }
  }

  /**
   * Build the synchronous, in-memory readers the collector uses. Never performs
   * network I/O.
   */
  private buildDiagnosticsReaders(): DiagnosticsReaders {
    return {
      devices: () => this.collectDeviceGauges(),
      tokenExpiresInSec: () => this.tokenManager?.getStatus().expiresInSec ?? null,
      tokenLastRefreshAt: () => this.tokenManager?.getStatus().lastRefreshAt ?? null,
      tokenRefreshFailureActive: () =>
        this.lastRefreshFailureAt !== null
        && Date.now() - this.lastRefreshFailureAt < TOKEN_REFRESH_FAILURE_COOLDOWN_MS,
      pollingCadenceSec: () => this.pollingCadenceSeconds(),
    }
  }

  /**
   * Compute absolute device gauges from the latest polled state stored on each
   * accessory's context. Reachability and active conditions are the meaningful
   * signals for these read-only sensors.
   */
  private collectDeviceGauges(): DeviceGauges {
    let online = 0
    let leak = 0
    let lowBattery = 0
    for (const accessory of this.accessories) {
      const device = accessory.context.device as WaterLeakDetector | undefined
      if (!device) {
        continue
      }
      if (isDeviceActive(device)) {
        online++
      }
      if (isLeakDetected(device)) {
        leak++
      }
      if (device.batteryRemaining !== undefined && isLowBattery(device.batteryRemaining)) {
        lowBattery++
      }
    }
    return { cloud: this.lastCloudDetectorCount, total: this.handlers.size, online, leak, lowBattery }
  }

  /**
   * Emit a diagnostics report as a human-readable line, plus a structured JSON
   * line when options.structuredLogs is enabled. The report is already redacted.
   */
  private emitDiagnostic(
    level: 'info' | 'warn',
    report: DiagnosticsSnapshot,
    options: { concise?: boolean } = {},
  ): void {
    // A transition logs a concise state-only human line, since the heartbeat that
    // detected it already emitted the full metrics body; everything else logs the
    // full summary line.
    this.log[level](options.concise ? formatHealthTransitionLine(report) : formatDiagnosticLine(report))
    if (this.config.options?.structuredLogs) {
      // Emit the report as-is: `msg` plus the nested groups (lifecycle, devices,
      // polling, token, api, activity, and the config echo on snapshots). The
      // report is already redacted, so this never carries credentials.
      this.log[level](JSON.stringify(report))
    }
  }

  /**
   * Persist a rotated refresh token back into config.json so it survives a
   * Homebridge restart. Writes atomically (temp file + rename) so a crash
   * mid-write cannot corrupt config. A failure here is serious — the rotated
   * token is only in memory, so the next restart will read the now-invalidated
   * old token and require re-linking — so it is logged at error level with that
   * consequence spelled out, but never thrown (rotation already succeeded).
   */
  private async persistRefreshToken(newRefreshToken: string): Promise<void> {
    this.config.credentials.refreshToken = newRefreshToken
    try {
      const configPath = this.api.user.configPath()
      const raw = await fs.readFile(configPath, 'utf8')
      const parsed = JSON.parse(raw) as { platforms?: ResideoPlatformConfig[] }
      const blocks = parsed.platforms?.filter(p => p.platform === PLATFORM_NAME) ?? []
      const block = this.selectConfigBlock(blocks)
      if (!block?.credentials) {
        this.log.error(
          'Could not persist the rotated refresh token: this platform block was not found in config.json. '
          + 'A future Homebridge restart may require re-linking your account.',
        )
        return
      }
      block.credentials.refreshToken = newRefreshToken
      const tempPath = `${configPath}.${process.pid}.${Date.now()}.tmp`
      await fs.writeFile(tempPath, JSON.stringify(parsed, null, 4), 'utf8')
      await fs.rename(tempPath, configPath)
      this.log.debug(`Persisted rotated refresh token to config.json (${maskToken(newRefreshToken)})`)
    } catch (err) {
      this.log.error(
        `Could not persist the rotated refresh token: ${sanitizeError(err)}. `
        + 'A future Homebridge restart may require re-linking your account.',
      )
    }
  }

  /**
   * Choose which platform block to write the rotated token into. With a single
   * block the choice is unambiguous; with several, only a unique name match is
   * safe. Refuse to guess when multiple blocks share this instance's name,
   * rather than risk writing the token into the wrong instance's credentials.
   */
  private selectConfigBlock(blocks: ResideoPlatformConfig[]): ResideoPlatformConfig | undefined {
    if (blocks.length <= 1) {
      return blocks[0]
    }
    const named = blocks.filter(p => p.name === this.config.name)
    if (named.length === 1) {
      return named[0]
    }
    this.log.error(
      'Multiple MyResideo platform blocks share the same name; cannot safely persist the rotated '
      + 'refresh token. Give each platform block a unique "name" in config.json.',
    )
    return undefined
  }
}

/** Human-readable label for a diagnostics channel (structured JSON keeps `msg`). */
function diagnosticLabel(msg: string): string {
  switch (msg) {
    case 'health':
      return 'Health'
    case 'diagnostics.start':
      return 'Diagnostics start'
    case 'diagnostics.stop':
      return 'Diagnostics stop'
    case 'health.degraded':
      return 'Health degraded'
    case 'health.recovered':
      return 'Health recovered'
    default:
      return msg
  }
}

/** Build the concise human-readable summary line for a diagnostics report. */
function formatDiagnosticLine(report: DiagnosticsSnapshot): string {
  const { lifecycle, devices, polling, token, api, activity } = report
  const reasonText = lifecycle.reasons.length > 0 ? ` [${lifecycle.reasons.join(', ')}]` : ''
  const pollDuration = polling.lastDurationMs === null ? 'n/a' : `${polling.lastDurationMs}ms`
  const tokenExp = token.expiresInSec === null ? 'n/a' : `${token.expiresInSec}s`
  // This plugin is polling-only, so each device poll is exactly one API request:
  // `api.requests`/`api.errors` would merely restate the poll counts plus the
  // retried transient failures. The human line therefore reports the poll
  // outcome once, surfaces the retry count (the only extra signal `err` carried),
  // and keeps only the latency percentiles from the API metrics. Raw request and
  // error totals remain in the structured-JSON report for log parsers.
  return (
    `${diagnosticLabel(report.msg)}: ${lifecycle.health}${reasonText} | `
    + `detectors ${devices.online}/${devices.total} online (${devices.leak} leak) | `
    + `poll ${pollDuration} ok ${polling.ok} failed ${polling.failed} retried ${activity.retries} | `
    + `latency p50 ${api.p50Ms}ms p95 ${api.p95Ms}ms | `
    + `token exp ${tokenExp}`
  )
}

/**
 * Concise health-transition notice: state and reasons only. The heartbeat that
 * detected the change already emitted the full metrics body on the line above,
 * so repeating it here would just duplicate that content. Degraded transitions
 * are logged at warn, so this keeps the actionable reasons visible in
 * warn-filtered logs without the redundant tail.
 */
function formatHealthTransitionLine(report: DiagnosticsSnapshot): string {
  const { lifecycle } = report
  const reasonText = lifecycle.reasons.length > 0 ? ` [${lifecycle.reasons.join(', ')}]` : ''
  return `${diagnosticLabel(report.msg)}: ${lifecycle.health}${reasonText}`
}
