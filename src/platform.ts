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
import { RefreshTokenInvalidError } from './errors'
import {
  DEFAULT_REFRESH_RATE_SEC,
  MIN_REFRESH_RATE_SEC,
  PLATFORM_NAME,
  PLUGIN_NAME,
  UUID_PREFIX,
} from './settings'
import type { LeakDetectorOptions, ResideoPlatformConfig, WaterLeakDetector } from './types'
import { isWaterLeakDetector } from './utils'

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

  constructor(
    private readonly log: Logging,
    config: ResideoPlatformConfig,
    private readonly api: API,
  ) {
    this.Service = api.hap.Service
    this.Characteristic = api.hap.Characteristic
    this.config = config

    if (!this.hasValidCredentials()) {
      this.log.error('Missing Resideo credentials (consumerKey, consumerSecret, refreshToken). '
        + 'Open the plugin settings and link your account. Plugin will not start.')
      return
    }

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
      timeoutMs: undefined,
      logger: this.log,
    })

    this.api.on('didFinishLaunching', () => {
      void this.discoverDevices()
    })
    this.api.on('shutdown', () => {
      if (this.pollTimer) {
        clearInterval(this.pollTimer)
      }
    })
  }

  /** Restore an accessory from the Homebridge cache. */
  configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.push(accessory)
  }

  private hasValidCredentials(): boolean {
    const c = this.config.credentials
    return Boolean(c && c.consumerKey && c.consumerSecret && c.refreshToken)
  }

  private get refreshRateMs(): number {
    const configured = this.config.options?.refreshRate ?? DEFAULT_REFRESH_RATE_SEC
    return Math.max(configured, MIN_REFRESH_RATE_SEC) * 1000
  }

  private async discoverDevices(): Promise<void> {
    if (!this.client) {
      return
    }
    try {
      const locations = await this.client.getLocations()
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

      this.startPolling()
    } catch (err) {
      this.handleError('discoverDevices', err)
    }
  }

  private registerDevice(device: WaterLeakDetector, locationId: number): void {
    const options = this.optionsForDevice(device.deviceID)
    const displayName = options.name || device.userDefinedDeviceName || 'Water Leak Detector'
    const uuid = this.api.hap.uuid.generate(`${UUID_PREFIX}${device.deviceID}`)
    this.locationByDevice.set(device.deviceID, locationId)

    let accessory = this.accessories.find(a => a.UUID === uuid)
    if (accessory) {
      accessory.context.device = device
      this.api.updatePlatformAccessories([accessory])
    } else {
      accessory = new this.api.platformAccessory(displayName, uuid)
      accessory.context.device = device
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
      this.log.info(`Registered new water leak detector: ${displayName}`)
    }

    const handler = new LeakSensorAccessory(this, accessory, options, this.config.options?.freezeThresholdCelsius)
    this.handlers.set(device.deviceID, handler)
  }

  private optionsForDevice(deviceID: string): LeakDetectorOptions {
    const override = this.config.options?.devices?.find(d => d.deviceID === deviceID)
    return override ?? { deviceID }
  }

  private startPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
    }
    this.pollTimer = setInterval(() => {
      void this.pollAll()
    }, this.refreshRateMs)
  }

  private async pollAll(): Promise<void> {
    if (!this.client) {
      return
    }
    for (const [deviceID, handler] of this.handlers) {
      const locationId = this.locationByDevice.get(deviceID)
      if (locationId === undefined) {
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

  private handleError(context: string, err: unknown): void {
    if (err instanceof RefreshTokenInvalidError) {
      this.log.error(`[${context}] Refresh token invalid. Re-link your account in the plugin settings.`)
      return
    }
    const message = err instanceof Error ? err.message : String(err)
    this.log.error(`[${context}] ${message}`)
  }

  /**
   * Persist a rotated refresh token back into config.json so it survives a
   * Homebridge restart. Best-effort: failures are logged, not thrown.
   */
  private async persistRefreshToken(newRefreshToken: string): Promise<void> {
    this.config.credentials.refreshToken = newRefreshToken
    try {
      const configPath = this.api.user.configPath()
      const raw = await fs.readFile(configPath, 'utf8')
      const parsed = JSON.parse(raw) as { platforms?: ResideoPlatformConfig[] }
      const block = parsed.platforms?.find(p => p.platform === PLATFORM_NAME)
      if (block?.credentials) {
        block.credentials.refreshToken = newRefreshToken
        await fs.writeFile(configPath, JSON.stringify(parsed, null, 4), 'utf8')
        this.log.debug('Persisted rotated refresh token to config.json')
      }
    } catch (err) {
      this.log.warn(`Could not persist rotated refresh token: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
