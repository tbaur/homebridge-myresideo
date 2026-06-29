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
  MIN_REFRESH_RATE_SEC,
  PLATFORM_NAME,
  PLUGIN_NAME,
  POLL_DEVICE_CONCURRENCY,
  UUID_PREFIX,
} from './settings'
import type { LeakDetectorOptions, ResideoPlatformConfig, WaterLeakDetector } from './types'
import { isWaterLeakDetector, maskToken, sanitizeError, sanitizeFreezeThreshold, validateConfig } from './utils'

export default class ResideoPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof ServiceClass
  public readonly Characteristic: typeof CharacteristicClass
  public readonly accessories: PlatformAccessory[] = []

  private readonly config: ResideoPlatformConfig
  private readonly handlers = new Map<string, LeakSensorAccessory>()
  private readonly locationByDevice = new Map<string, number>()

  private tokenManager?: TokenManager
  private client?: ResideoApiClient
  private pollTimer?: ReturnType<typeof setInterval>
  private discoveryTimer?: ReturnType<typeof setTimeout>
  private discoveryAttempt = 0
  private isPolling = false
  private stopped = false
  /** True when startup validation failed; the platform stays inert. */
  private disabled = false

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

    this.tokenManager = new TokenManager({
      consumerKey: config.credentials.consumerKey,
      consumerSecret: config.credentials.consumerSecret,
      refreshToken: config.credentials.refreshToken,
      accessToken: config.credentials.accessToken,
      logger: this.log,
      onRefreshToken: token => this.persistRefreshToken(token),
    })

    this.client = new ResideoApiClient({
      tokenManager: this.tokenManager,
      apikey: config.credentials.consumerKey,
      logger: this.log,
    })

    this.api.on('didFinishLaunching', () => {
      void this.discoverDevices()
    })
    this.api.on('shutdown', () => {
      this.stopped = true
      if (this.pollTimer) {
        clearInterval(this.pollTimer)
      }
      if (this.discoveryTimer) {
        clearTimeout(this.discoveryTimer)
      }
    })
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
      for (const { device, locationId } of detectors) {
        this.registerDevice(device, locationId)
      }

      this.pruneStaleAccessories(new Set(detectors.map(d => d.device.deviceID)))

      this.discoveryAttempt = 0
      await this.runPollCycle()
      this.startPolling()
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
    try {
      await this.pollAll()
    } finally {
      this.isPolling = false
    }
  }

  /** Poll every device with bounded concurrency so cycle time stays bounded. */
  private async pollAll(): Promise<void> {
    if (!this.client) {
      return
    }
    // Snapshot the device IDs that currently have a known location. Each worker
    // re-checks per device below, since pruning/discovery can mutate the maps
    // while a cycle is in flight.
    const deviceIds = [...this.handlers.keys()].filter(id => this.locationByDevice.has(id))
    const workerCount = Math.min(POLL_DEVICE_CONCURRENCY, deviceIds.length)
    if (workerCount === 0) {
      return
    }

    let nextIndex = 0
    const worker = async (): Promise<void> => {
      while (nextIndex < deviceIds.length) {
        const deviceID = deviceIds[nextIndex++]
        const locationId = this.locationByDevice.get(deviceID)
        const handler = this.handlers.get(deviceID)
        if (locationId === undefined || !handler || !this.client) {
          continue
        }
        try {
          const device = await this.client.getWaterLeakDetector(deviceID, locationId)
          handler.updateStatus(device)
        } catch (err) {
          this.handleError(`poll ${deviceID}`, err)
        }
      }
    }

    await Promise.all(Array.from({ length: workerCount }, () => worker()))
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
