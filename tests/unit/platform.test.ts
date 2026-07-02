/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Unit tests for ResideoPlatform with mocked API, device, and fs.
 */

const mockGetLocations = jest.fn()
const mockGetDetector = jest.fn()
const mockUpdateStatus = jest.fn()
const mockReadFile = jest.fn()
const mockWriteFile = jest.fn()
const mockRename = jest.fn()

jest.mock('../../src/api', () => ({
  ResideoApiClient: jest.fn(),
  TokenManager: jest.fn(),
}))

jest.mock('../../src/devices/leak-sensor', () => ({
  LeakSensorAccessory: jest.fn(),
}))

jest.mock('node:fs', () => ({
  promises: {
    readFile: mockReadFile,
    writeFile: mockWriteFile,
    rename: mockRename,
  },
}))

import { ResideoApiClient, TokenManager } from '../../src/api'
import { LeakSensorAccessory } from '../../src/devices/leak-sensor'
import { ApiParseError, ApiResponseError, ForbiddenError, NetworkError, RefreshTokenInvalidError } from '../../src/errors'
import ResideoPlatform from '../../src/platform'
import { DEFAULT_REFRESH_RATE_SEC, MIN_REFRESH_RATE_SEC } from '../../src/settings'
import type { ResideoPlatformConfig, WaterLeakDetector } from '../../src/types'
import type { API, Logging, PlatformAccessory } from 'homebridge'

const leakDevice: WaterLeakDetector = {
  deviceID: 'dev-1',
  deviceClass: 'LeakDetector',
  deviceType: 'Water Leak Detector',
  waterPresent: false,
}

function makeLog(): Logging {
  const log = jest.fn() as unknown as Logging
  log.info = jest.fn()
  log.warn = jest.fn()
  log.error = jest.fn()
  log.debug = jest.fn()
  return log
}

function makeApi() {
  const handlers: Record<string, () => void> = {}
  const api = {
    hap: {
      Service: {},
      Characteristic: {},
      uuid: { generate: (s: string) => `uuid-${s}` },
    },
    on: jest.fn((event: string, cb: () => void) => {
      handlers[event] = cb
    }),
    platformAccessory: jest.fn((name: string, uuid: string) => ({
      displayName: name,
      UUID: uuid,
      context: {} as Record<string, unknown>,
    })),
    registerPlatformAccessories: jest.fn(),
    updatePlatformAccessories: jest.fn(),
    unregisterPlatformAccessories: jest.fn(),
    user: { configPath: jest.fn(() => '/tmp/config.json') },
  }
  return { api, handlers }
}

function validConfig(): ResideoPlatformConfig {
  return {
    platform: 'MyResideo',
    name: 'MyResideo',
    credentials: {
      consumerKey: 'key',
      consumerSecret: 'secret',
      refreshToken: 'refresh',
    },
  } as ResideoPlatformConfig
}

const flush = () => new Promise<void>(resolve => setImmediate(resolve))

beforeEach(() => {
  (ResideoApiClient as unknown as jest.Mock).mockImplementation(() => ({
    getLocations: mockGetLocations,
    getWaterLeakDetector: mockGetDetector,
  }));
  (TokenManager as unknown as jest.Mock).mockImplementation((opts: unknown) => ({ opts }));
  (LeakSensorAccessory as unknown as jest.Mock).mockImplementation(() => ({ updateStatus: mockUpdateStatus }))
  mockGetLocations.mockReset()
  mockGetDetector.mockReset()
  mockUpdateStatus.mockReset()
  mockReadFile.mockReset()
  mockWriteFile.mockReset().mockResolvedValue(undefined)
  mockRename.mockReset().mockResolvedValue(undefined)
})

describe('ResideoPlatform construction', () => {
  it('does not start when the config is invalid', () => {
    const log = makeLog()
    const { api } = makeApi()
    new ResideoPlatform(log, { platform: 'MyResideo' } as ResideoPlatformConfig, api as unknown as API)

    expect(ResideoApiClient).not.toHaveBeenCalled()
    expect(api.on).not.toHaveBeenCalled()
    expect(log.error).toHaveBeenCalled()
  })

  it('constructs the client and registers lifecycle hooks when valid', () => {
    const log = makeLog()
    const { api } = makeApi()
    new ResideoPlatform(log, validConfig(), api as unknown as API)

    expect(TokenManager).toHaveBeenCalledTimes(1)
    expect(ResideoApiClient).toHaveBeenCalledTimes(1)
    expect(api.on).toHaveBeenCalledWith('didFinishLaunching', expect.any(Function))
    expect(api.on).toHaveBeenCalledWith('shutdown', expect.any(Function))
  })
})

describe('discovery and polling', () => {
  it('discovers, registers, and immediately polls detectors', async () => {
    mockGetLocations.mockResolvedValue([{ locationID: 1, devices: [leakDevice] }])
    mockGetDetector.mockResolvedValue(leakDevice)

    const log = makeLog()
    const { api, handlers } = makeApi()
    new ResideoPlatform(log, validConfig(), api as unknown as API)

    handlers.didFinishLaunching()
    await flush()

    expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(1)
    expect(LeakSensorAccessory).toHaveBeenCalledTimes(1)
    expect(mockGetDetector).toHaveBeenCalledWith('dev-1', 1)
    // The poll also passes the request latency so the accessory can annotate its
    // per-check-in report.
    expect(mockUpdateStatus).toHaveBeenCalledWith(leakDevice, expect.any(Number))

    handlers.shutdown()
  })

  it('logs a one-line state summary for each discovered detector at startup', async () => {
    mockGetLocations.mockResolvedValue([{ locationID: 1, devices: [leakDevice] }])
    mockGetDetector.mockResolvedValue(leakDevice)

    const log = makeLog()
    const { api, handlers } = makeApi()
    new ResideoPlatform(log, validConfig(), api as unknown as API)

    handlers.didFinishLaunching()
    await flush()

    expect(log.info).toHaveBeenCalledWith('Discovered 1 water leak detector(s)')
    expect(log.info).toHaveBeenCalledWith(
      'Water Leak Detector: online | dry | temp n/a | humidity n/a | battery n/a',
    )

    handlers.shutdown()
  })

  it('unregisters stale cached accessories that are no longer in the account', async () => {
    mockGetLocations.mockResolvedValue([{ locationID: 1, devices: [leakDevice] }])
    mockGetDetector.mockResolvedValue(leakDevice)

    const log = makeLog()
    const { api, handlers } = makeApi()
    const platform = new ResideoPlatform(log, validConfig(), api as unknown as API)

    const stale = {
      UUID: 'uuid-old',
      displayName: 'Old Detector',
      context: { device: { deviceID: 'old-dev' } },
    } as unknown as PlatformAccessory
    platform.configureAccessory(stale)

    handlers.didFinishLaunching()
    await flush()

    expect(api.unregisterPlatformAccessories).toHaveBeenCalledWith(
      'homebridge-myresideo',
      'MyResideo',
      [stale],
    )

    handlers.shutdown()
  })

  it('skips a poll tick when a previous cycle is still running', async () => {
    mockGetLocations.mockResolvedValue([{ locationID: 1, devices: [leakDevice] }])
    let releaseDetector: (d: WaterLeakDetector) => void = () => {}
    mockGetDetector.mockReturnValue(new Promise<WaterLeakDetector>((resolve) => {
      releaseDetector = resolve
    }))

    const log = makeLog()
    const { api, handlers } = makeApi()
    const platform = new ResideoPlatform(log, validConfig(), api as unknown as API)
    handlers.didFinishLaunching()
    await flush() // discovery done; immediate poll is now hanging on getDetector

    const internal = platform as unknown as { runPollCycle: () => Promise<void> }
    await internal.runPollCycle() // should hit the in-flight guard and return

    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('Skipping poll tick'))

    releaseDetector(leakDevice)
    await flush()
    handlers.shutdown()
  })
})

describe('discovery error handling', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('retries discovery with backoff after a transient failure', async () => {
    jest.useFakeTimers()
    mockGetLocations
      .mockRejectedValueOnce(new NetworkError('transient'))
      .mockResolvedValueOnce([{ locationID: 1, devices: [leakDevice] }])
    mockGetDetector.mockResolvedValue(leakDevice)

    const log = makeLog()
    const { api, handlers } = makeApi()
    new ResideoPlatform(log, validConfig(), api as unknown as API)

    handlers.didFinishLaunching()
    await jest.advanceTimersByTimeAsync(0)
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Retrying device discovery'))

    await jest.advanceTimersByTimeAsync(15_000)
    expect(mockGetLocations).toHaveBeenCalledTimes(2)
    expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(1)

    handlers.shutdown()
  })

  it('does not retry after a non-recoverable auth failure', async () => {
    jest.useFakeTimers()
    mockGetLocations.mockRejectedValue(new RefreshTokenInvalidError())

    const log = makeLog()
    const { api, handlers } = makeApi()
    new ResideoPlatform(log, validConfig(), api as unknown as API)

    handlers.didFinishLaunching()
    await jest.advanceTimersByTimeAsync(0)

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Re-link'))
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('non-recoverable'))

    await jest.advanceTimersByTimeAsync(120_000)
    expect(mockGetLocations).toHaveBeenCalledTimes(1)

    handlers.shutdown()
  })

  it.each([
    ['a forbidden (403) error', () => new ForbiddenError('forbidden')],
    ['an unparseable payload', () => new ApiParseError('bad json')],
    ['a non-retryable 404', () => new ApiResponseError(404, 'not found')],
  ])('does not retry discovery after %s', async (_label, makeErr) => {
    jest.useFakeTimers()
    mockGetLocations.mockRejectedValue(makeErr())

    const log = makeLog()
    const { api, handlers } = makeApi()
    new ResideoPlatform(log, validConfig(), api as unknown as API)

    handlers.didFinishLaunching()
    await jest.advanceTimersByTimeAsync(0)

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('non-recoverable'))

    await jest.advanceTimersByTimeAsync(5 * 60_000)
    expect(mockGetLocations).toHaveBeenCalledTimes(1)

    handlers.shutdown()
  })
})

describe('accessory re-discovery', () => {
  it('updates a cached accessory display name when the device name changes', async () => {
    const renamed: WaterLeakDetector = { ...leakDevice, userDefinedDeviceName: 'Kitchen' }
    mockGetLocations.mockResolvedValue([{ locationID: 1, devices: [renamed] }])
    mockGetDetector.mockResolvedValue(renamed)

    const log = makeLog()
    const { api, handlers } = makeApi()
    const platform = new ResideoPlatform(log, validConfig(), api as unknown as API)

    const cached = {
      UUID: 'uuid-myresideo-dev-1',
      displayName: 'Old Name',
      context: { device: { ...leakDevice } },
    } as unknown as PlatformAccessory
    platform.configureAccessory(cached)

    handlers.didFinishLaunching()
    await flush()

    expect(cached.displayName).toBe('Kitchen')
    expect(api.updatePlatformAccessories).toHaveBeenCalledWith([cached])
    expect(api.registerPlatformAccessories).not.toHaveBeenCalled()
    // The boot summary is logged for cached accessories too, using the resolved name.
    expect(log.info).toHaveBeenCalledWith('Kitchen: online | dry | temp n/a | humidity n/a | battery n/a')

    handlers.shutdown()
  })
})

describe('boot state summary', () => {
  const summaryLineCount = (log: Logging, name: string): number =>
    (log.info as jest.Mock).mock.calls
      .concat((log.warn as jest.Mock).mock.calls)
      .filter(call => String(call[0]).startsWith(`${name}:`)).length

  it('logs the boot summary at warn when a detector is leaking at startup', async () => {
    const leaking: WaterLeakDetector = { ...leakDevice, waterPresent: true }
    mockGetLocations.mockResolvedValue([{ locationID: 1, devices: [leaking] }])
    mockGetDetector.mockResolvedValue(leaking)

    const log = makeLog()
    const { api, handlers } = makeApi()
    new ResideoPlatform(log, validConfig(), api as unknown as API)

    handlers.didFinishLaunching()
    await flush()

    expect(log.warn).toHaveBeenCalledWith(
      'Water Leak Detector: online | LEAK DETECTED | temp n/a | humidity n/a | battery n/a',
    )

    handlers.shutdown()
  })

  it('logs the boot summary once per device, not again on a later discovery pass', async () => {
    mockGetLocations.mockResolvedValue([{ locationID: 1, devices: [leakDevice] }])
    mockGetDetector.mockResolvedValue(leakDevice)

    const log = makeLog()
    const { api, handlers } = makeApi()
    const platform = new ResideoPlatform(log, validConfig(), api as unknown as API)

    handlers.didFinishLaunching()
    await flush()
    expect(summaryLineCount(log, 'Water Leak Detector')).toBe(1)

    // Re-registering the same detector (as a discovery retry would) must not re-log.
    const internal = platform as unknown as { registerDevice: (d: WaterLeakDetector, loc: number) => void }
    internal.registerDevice(leakDevice, 1)
    expect(summaryLineCount(log, 'Water Leak Detector')).toBe(1)

    handlers.shutdown()
  })
})

describe('refresh token persistence', () => {
  it('writes the rotated token atomically (temp file + rename)', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      platforms: [{ platform: 'MyResideo', name: 'MyResideo', credentials: { refreshToken: 'old' } }],
    }))

    const log = makeLog()
    const { api } = makeApi()
    new ResideoPlatform(log, validConfig(), api as unknown as API)

    const tokenOpts = (TokenManager as unknown as jest.Mock).mock.calls[0][0] as {
      onRefreshToken: (token: string) => Promise<void>
    }
    await tokenOpts.onRefreshToken('rotated-token')

    expect(mockWriteFile).toHaveBeenCalledTimes(1)
    const [tempPath, content] = mockWriteFile.mock.calls[0] as [string, string]
    expect(tempPath).toMatch(/\.tmp$/)
    expect(content).toContain('rotated-token')
    expect(mockRename).toHaveBeenCalledWith(tempPath, '/tmp/config.json')
  })

  it('does not throw when persistence fails', async () => {
    mockReadFile.mockRejectedValue(new Error('disk gone'))

    const log = makeLog()
    const { api } = makeApi()
    new ResideoPlatform(log, validConfig(), api as unknown as API)

    const tokenOpts = (TokenManager as unknown as jest.Mock).mock.calls[0][0] as {
      onRefreshToken: (token: string) => Promise<void>
    }
    await expect(tokenOpts.onRefreshToken('rotated-token')).resolves.toBeUndefined()
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Could not persist'))
  })

  it('refuses to persist when multiple platform blocks share the same name', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      platforms: [
        { platform: 'MyResideo', name: 'MyResideo', credentials: { refreshToken: 'old-a' } },
        { platform: 'MyResideo', name: 'MyResideo', credentials: { refreshToken: 'old-b' } },
      ],
    }))

    const log = makeLog()
    const { api } = makeApi()
    new ResideoPlatform(log, validConfig(), api as unknown as API)

    const tokenOpts = (TokenManager as unknown as jest.Mock).mock.calls[0][0] as {
      onRefreshToken: (token: string) => Promise<void>
    }
    await tokenOpts.onRefreshToken('rotated-token')

    expect(mockWriteFile).not.toHaveBeenCalled()
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('unique "name"'))
  })

  it('selects the block matching this instance name when several blocks exist', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      platforms: [
        { platform: 'MyResideo', name: 'Other', credentials: { refreshToken: 'old-other' } },
        { platform: 'MyResideo', name: 'MyResideo', credentials: { refreshToken: 'old-mine' } },
      ],
    }))

    const log = makeLog()
    const { api } = makeApi()
    new ResideoPlatform(log, validConfig(), api as unknown as API)

    const tokenOpts = (TokenManager as unknown as jest.Mock).mock.calls[0][0] as {
      onRefreshToken: (token: string) => Promise<void>
    }
    await tokenOpts.onRefreshToken('rotated-token')

    const [, content] = mockWriteFile.mock.calls[0] as [string, string]
    const written = JSON.parse(content) as { platforms: ResideoPlatformConfig[] }
    expect(written.platforms[0].credentials.refreshToken).toBe('old-other')
    expect(written.platforms[1].credentials.refreshToken).toBe('rotated-token')
  })
})

describe('refresh rate', () => {
  function refreshRateMsFor(refreshRate: unknown): number {
    const log = makeLog()
    const { api } = makeApi()
    const config = validConfig()
    config.options = { refreshRate: refreshRate as number }
    const platform = new ResideoPlatform(log, config, api as unknown as API)
    return (platform as unknown as { refreshRateMs: number }).refreshRateMs
  }

  it('falls back to the default when refreshRate is not a number', () => {
    expect(refreshRateMsFor('fast')).toBe(DEFAULT_REFRESH_RATE_SEC * 1000)
    expect(refreshRateMsFor(NaN)).toBe(DEFAULT_REFRESH_RATE_SEC * 1000)
  })

  it('clamps a too-small refreshRate to the minimum', () => {
    expect(refreshRateMsFor(5)).toBe(MIN_REFRESH_RATE_SEC * 1000)
  })

  it('honors a valid refreshRate', () => {
    expect(refreshRateMsFor(300)).toBe(300 * 1000)
  })
})

describe('diagnostics', () => {
  interface TokenOpts {
    onRefreshSuccess?: () => void
    onRefreshFailure?: () => void
  }

  /**
   * Override the TokenManager mock with one that exposes the getStatus() surface
   * the diagnostics readers call, and capture the options so a test can drive the
   * refresh-success/failure callbacks. Returns a live reference to the captured
   * options (populated once the platform constructs the TokenManager).
   */
  function stubTokenManagerWithStatus(): { current: TokenOpts | undefined } {
    const captured: { current: TokenOpts | undefined } = { current: undefined }
    ;(TokenManager as unknown as jest.Mock).mockImplementation((opts: TokenOpts) => {
      captured.current = opts
      return {
        opts,
        getStatus: () => ({ expiresInSec: 1000, lastRefreshAt: null }),
        getAccessToken: jest.fn(),
        forceRefresh: jest.fn(),
        getRefreshToken: jest.fn(),
      }
    })
    return captured
  }

  function diagnosticsConfig(overrides: Record<string, unknown> = {}): ResideoPlatformConfig {
    const config = validConfig()
    config.options = { diagnosticsInterval: 30, ...overrides }
    return config
  }

  afterEach(() => {
    jest.useRealTimers()
  })

  it('emits a boot snapshot, periodic heartbeat, and a stop snapshot', async () => {
    jest.useFakeTimers()
    stubTokenManagerWithStatus()
    mockGetLocations.mockResolvedValue([{ locationID: 1, devices: [leakDevice] }])
    mockGetDetector.mockResolvedValue(leakDevice)

    const log = makeLog()
    const { api, handlers } = makeApi()
    new ResideoPlatform(log, diagnosticsConfig(), api as unknown as API)

    handlers.didFinishLaunching()
    await jest.advanceTimersByTimeAsync(0)
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Diagnostics start'))

    // The 30s diagnostics interval fires before the 120s poll interval.
    await jest.advanceTimersByTimeAsync(30_000)
    const healthLine = (log.info as jest.Mock).mock.calls
      .map(args => args[0] as string)
      .find(line => typeof line === 'string' && line.includes('Health: healthy'))
    expect(healthLine).toBeDefined()
    // Request activity is reported once: this plugin is polling-only, so the API
    // `req`/`err` counts would just restate the poll counts. The line surfaces
    // retries and keeps only the latency percentiles from the API metrics.
    expect(healthLine).toContain('poll')
    expect(healthLine).toContain('retried')
    expect(healthLine).toContain('latency p50')
    expect(healthLine).not.toContain('req ')
    expect(healthLine).not.toContain('api p50')

    handlers.shutdown()
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Diagnostics stop'))
  })

  it('does not emit diagnostics when diagnosticsInterval is unset (default off)', async () => {
    jest.useFakeTimers()
    stubTokenManagerWithStatus()
    mockGetLocations.mockResolvedValue([{ locationID: 1, devices: [leakDevice] }])
    mockGetDetector.mockResolvedValue(leakDevice)

    const log = makeLog()
    const { api, handlers } = makeApi()
    new ResideoPlatform(log, validConfig(), api as unknown as API)

    handlers.didFinishLaunching()
    await jest.advanceTimersByTimeAsync(0)
    await jest.advanceTimersByTimeAsync(60_000)

    expect(log.info).not.toHaveBeenCalledWith(expect.stringContaining('Diagnostics start'))
    expect(log.info).not.toHaveBeenCalledWith(expect.stringContaining('Health:'))

    handlers.shutdown()
  })

  it('emits a structured JSON line when structuredLogs is enabled', async () => {
    jest.useFakeTimers()
    stubTokenManagerWithStatus()
    mockGetLocations.mockResolvedValue([{ locationID: 1, devices: [leakDevice] }])
    mockGetDetector.mockResolvedValue(leakDevice)

    const log = makeLog()
    const { api, handlers } = makeApi()
    new ResideoPlatform(log, diagnosticsConfig({ structuredLogs: true }), api as unknown as API)

    handlers.didFinishLaunching()
    await jest.advanceTimersByTimeAsync(0)

    const jsonLine = (log.info as jest.Mock).mock.calls
      .map(args => args[0] as string)
      .find(line => typeof line === 'string' && line.startsWith('{'))
    expect(jsonLine).toBeDefined()
    const parsed = JSON.parse(jsonLine as string) as { msg: string, lifecycle: { health: string } }
    expect(parsed.msg).toBe('diagnostics.start')
    expect(parsed.lifecycle.health).toBe('healthy')
    // The lifecycle fields live only under the nested object, not duplicated at root.
    expect(parsed).not.toHaveProperty('health')

    handlers.shutdown()
  })

  it('logs a degraded transition when a token refresh starts failing', async () => {
    jest.useFakeTimers()
    const tokenOpts = stubTokenManagerWithStatus()
    mockGetLocations.mockResolvedValue([{ locationID: 1, devices: [leakDevice] }])
    mockGetDetector.mockResolvedValue(leakDevice)

    const log = makeLog()
    const { api, handlers } = makeApi()
    new ResideoPlatform(log, diagnosticsConfig(), api as unknown as API)

    handlers.didFinishLaunching()
    await jest.advanceTimersByTimeAsync(0) // boot snapshot: healthy

    // Simulate the token manager reporting a failed refresh, which opens the
    // degraded-health cooldown window the heartbeat reads.
    tokenOpts.current?.onRefreshFailure?.()

    await jest.advanceTimersByTimeAsync(30_000)
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Health degraded'))
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('tokenRefreshFailing'))

    // The transition notice is concise (state + reasons only); the heartbeat that
    // detected the change already carried the full metrics body, so none of it is
    // duplicated onto the transition line.
    const degradedLine = (log.warn as jest.Mock).mock.calls
      .map(args => args[0] as string)
      .find(line => typeof line === 'string' && line.includes('Health degraded'))
    expect(degradedLine).toBe('Health degraded: degraded [tokenRefreshFailing]')

    // A subsequent successful refresh clears the cooldown and recovers health.
    tokenOpts.current?.onRefreshSuccess?.()
    await jest.advanceTimersByTimeAsync(30_000)
    const recoveredLine = (log.info as jest.Mock).mock.calls
      .map(args => args[0] as string)
      .find(line => typeof line === 'string' && line.includes('Health recovered'))
    expect(recoveredLine).toBe('Health recovered: healthy')

    handlers.shutdown()
  })
})
