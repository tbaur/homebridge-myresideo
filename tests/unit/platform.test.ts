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
import { NetworkError, RefreshTokenInvalidError } from '../../src/errors'
import ResideoPlatform from '../../src/platform'
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
    expect(mockUpdateStatus).toHaveBeenCalledWith(leakDevice)

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
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Could not persist'))
  })
})
