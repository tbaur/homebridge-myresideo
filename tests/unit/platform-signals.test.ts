/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Platform wiring for PagerDuty signals. The writer is mocked
 * so these tests never open the signal store or the token file.
 */

const mockGetLocations = jest.fn()
const mockGetDetector = jest.fn()
const mockUpdateStatus = jest.fn()
const mockReadFileSync = jest.fn()

jest.mock('../../src/api', () => ({
  ResideoApiClient: jest.fn(),
  TokenManager: jest.fn(),
}))

jest.mock('../../src/devices/leak-sensor', () => ({
  LeakSensorAccessory: jest.fn(),
}))

jest.mock('node:fs', () => ({
  promises: {
    rename: jest.fn(),
    rm: jest.fn(),
    open: jest.fn(),
  },
  readFileSync: mockReadFileSync,
}))

jest.mock('../../src/resideo-signals', () => {
  const actual = jest.requireActual<typeof import('../../src/resideo-signals')>('../../src/resideo-signals')
  const signals = {
    start: jest.fn(),
    observe: jest.fn(),
    raiseOnly: jest.fn(),
    settle: jest.fn(),
    beginPoll: jest.fn(),
    noteAuth: jest.fn(),
    noteCloudReached: jest.fn(),
    noteReached: jest.fn(),
    noteOutage: jest.fn(),
    release: jest.fn(),
    close: jest.fn(),
  }
  const createResideoSignals = Object.assign(jest.fn(() => signals), { signals })
  return { ...actual, createResideoSignals }
})

import { ResideoApiClient, TokenManager } from '../../src/api'
import { LeakSensorAccessory } from '../../src/devices/leak-sensor'
import {
  ApiResponseError,
  AuthenticationError,
  ConfigurationError,
  ForbiddenError,
  NetworkError,
  RateLimitError,
  RefreshTokenInvalidError,
} from '../../src/errors'
import ResideoPlatform from '../../src/platform'
import { PAGERDUTY_STARTUP_LOG, createResideoSignals } from '../../src/resideo-signals'
import type { ResideoPlatformConfig, WaterLeakDetector } from '../../src/types'
import type { API, Logging, PlatformAccessory } from 'homebridge'

const TEST_STORAGE = '/tmp/hb-storage'

const signals = (createResideoSignals as jest.Mock & {
  signals: {
    start: jest.Mock
    observe: jest.Mock
    raiseOnly: jest.Mock
    settle: jest.Mock
    beginPoll: jest.Mock
    noteAuth: jest.Mock
    noteCloudReached: jest.Mock
    noteReached: jest.Mock
    noteOutage: jest.Mock
    release: jest.Mock
    close: jest.Mock
  }
}).signals

const leakDevice: WaterLeakDetector = {
  deviceID: 'dev-1',
  deviceClass: 'LeakDetector',
  deviceType: 'Water Leak Detector',
  waterPresent: false,
  userDefinedDeviceName: 'Utility room',
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
      uuid: { generate: (value: string) => `uuid-${value}` },
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
    user: {
      configPath: jest.fn(() => '/tmp/config.json'),
      storagePath: jest.fn(() => TEST_STORAGE),
    },
  }
  return { api, handlers }
}

function validConfig(pagerdutySignals?: boolean): ResideoPlatformConfig {
  return {
    platform: 'MyResideo',
    name: 'MyResideo',
    credentials: {
      consumerKey: 'key',
      consumerSecret: 'secret',
      refreshToken: 'refresh',
    },
    options: pagerdutySignals === undefined ? undefined : { pagerdutySignals },
  } as ResideoPlatformConfig
}

function cachedAccessory(device: WaterLeakDetector): PlatformAccessory {
  return {
    UUID: `uuid-${device.deviceID}`,
    displayName: device.userDefinedDeviceName ?? 'Cached',
    context: { device, locationId: 1 },
  } as unknown as PlatformAccessory
}

beforeEach(() => {
  (ResideoApiClient as unknown as jest.Mock).mockImplementation(() => ({
    getLocations: mockGetLocations,
    getWaterLeakDetector: mockGetDetector,
    getStatus: () => ({ circuitBreaker: { state: 'CLOSED' } }),
  }));
  (TokenManager as unknown as jest.Mock).mockImplementation((opts: unknown) => ({ opts }));
  (LeakSensorAccessory as unknown as jest.Mock).mockImplementation((
    _platform: unknown,
    accessory: { displayName?: string },
  ) => ({
    updateStatus: mockUpdateStatus,
    displayName: accessory.displayName ?? 'Water Leak Detector',
  }))
  mockGetLocations.mockReset()
  mockGetDetector.mockReset()
  mockUpdateStatus.mockReset()
  mockReadFileSync.mockReset().mockImplementation(() => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  })
  for (const fn of Object.values(signals)) {
    fn.mockReset()
  }
  // resetMocks drops the factory implementation before each test.
  ;(createResideoSignals as jest.Mock).mockReset()
  ;(createResideoSignals as jest.Mock).mockImplementation(() => signals)
})

describe('PagerDuty signal wiring', () => {
  it('does not create a writer when the setting is off or startup validation failed', () => {
    const log = makeLog()
    const off = makeApi()
    new ResideoPlatform(log, validConfig(), off.api as unknown as API)
    new ResideoPlatform(log, validConfig(false), makeApi().api as unknown as API)
    new ResideoPlatform(
      log,
      { platform: 'MyResideo', options: { pagerdutySignals: true } } as ResideoPlatformConfig,
      makeApi().api as unknown as API,
    )
    new ResideoPlatform(
      log,
      {
        ...validConfig(),
        options: { pagerdutySignals: 'true' as unknown as boolean },
      },
      makeApi().api as unknown as API,
    )

    expect(createResideoSignals).not.toHaveBeenCalled()
    expect(log.info).not.toHaveBeenCalledWith(PAGERDUTY_STARTUP_LOG)
  })

  it('opens the store from the Homebridge storage path and logs once before any request', () => {
    const log = makeLog()
    const { api, handlers } = makeApi()
    new ResideoPlatform(log, validConfig(true), api as unknown as API)

    expect(createResideoSignals).toHaveBeenCalledWith({
      plugin: 'homebridge-myresideo',
      storagePath: TEST_STORAGE,
      log,
    })
    expect(signals.start).toHaveBeenCalledTimes(1)
    expect(log.info).toHaveBeenCalledWith(PAGERDUTY_STARTUP_LOG)
    expect(mockGetLocations).not.toHaveBeenCalled()

    handlers.shutdown()
    expect(signals.close).toHaveBeenCalledTimes(1)
  })

  it('observes a locations body, then lets the following poll inherit that coverage', async () => {
    const body = { ...leakDevice, waterPresent: true }
    mockGetLocations.mockResolvedValue([{ locationID: 1, devices: [body] }])
    mockGetDetector.mockResolvedValue(body)

    const { api, handlers } = makeApi()
    new ResideoPlatform(makeLog(), validConfig(true), api as unknown as API)
    handlers.didFinishLaunching()
    await new Promise<void>(resolve => setImmediate(resolve))

    expect(signals.observe).toHaveBeenCalledWith(expect.objectContaining({
      deviceID: 'dev-1',
      waterPresent: true,
    }), false)
    expect(signals.settle).toHaveBeenCalledWith(expect.arrayContaining(['dev-1']))
    expect(signals.beginPoll).toHaveBeenNthCalledWith(1, false)
    expect(signals.beginPoll).toHaveBeenNthCalledWith(2, true)
    expect(signals.noteCloudReached).toHaveBeenCalled()
    expect(signals.noteReached).toHaveBeenCalledTimes(1)
    expect(signals.noteOutage).not.toHaveBeenCalled()
    expect(signals.noteAuth).not.toHaveBeenCalled()

    handlers.shutdown()
  })

  it('does not observe or clear from an empty list, including a cached detector', async () => {
    const cached = { ...leakDevice, waterPresent: true }
    mockGetLocations.mockResolvedValue([])
    mockGetDetector.mockRejectedValue(new NetworkError('down'))

    const { api, handlers } = makeApi()
    const platform = new ResideoPlatform(makeLog(), validConfig(true), api as unknown as API)
    platform.configureAccessory(cachedAccessory(cached))
    handlers.didFinishLaunching()
    await new Promise<void>(resolve => setImmediate(resolve))

    expect(signals.observe).not.toHaveBeenCalled()
    expect(signals.noteReached).not.toHaveBeenCalled()
    expect(signals.noteAuth).not.toHaveBeenCalled()
    expect(signals.noteOutage).toHaveBeenCalled()
    expect(signals.release).not.toHaveBeenCalled()

    handlers.shutdown()
  })

  it('does not treat an empty list with nothing cached as a clear', async () => {
    mockGetLocations.mockResolvedValue([])

    const { api, handlers } = makeApi()
    new ResideoPlatform(makeLog(), validConfig(true), api as unknown as API)
    handlers.didFinishLaunching()
    await new Promise<void>(resolve => setImmediate(resolve))

    expect(signals.noteOutage).toHaveBeenCalled()
    expect(signals.observe).not.toHaveBeenCalled()
    expect(signals.settle).not.toHaveBeenCalled()
    expect(signals.noteReached).not.toHaveBeenCalled()

    handlers.shutdown()
  })

  it('holds a placeholder GET against the cached detector instead of paging offline', async () => {
    const cached = { ...leakDevice, isAlive: true, batteryRemaining: 70 }
    const placeholder = {
      ...leakDevice,
      waterPresent: true,
      isAlive: false,
      isDeviceOffline: true,
      batteryRemaining: 0,
    }
    mockGetLocations.mockResolvedValue([])
    mockGetDetector.mockResolvedValue(placeholder)

    const { api, handlers } = makeApi()
    const platform = new ResideoPlatform(makeLog(), validConfig(true), api as unknown as API)
    platform.configureAccessory(cachedAccessory(cached))
    handlers.didFinishLaunching()
    await new Promise<void>(resolve => setImmediate(resolve))

    expect(signals.observe).toHaveBeenCalledWith({ ...cached, waterPresent: true }, true)

    handlers.shutdown()
  })

  it('observes a later GET of a cached detector and not the cached body', async () => {
    const cached = { ...leakDevice, waterPresent: true }
    const fresh = { ...leakDevice, waterPresent: false }
    mockGetLocations.mockResolvedValue([])
    mockGetDetector.mockResolvedValue(fresh)

    const { api, handlers } = makeApi()
    const platform = new ResideoPlatform(makeLog(), validConfig(true), api as unknown as API)
    platform.configureAccessory(cachedAccessory(cached))
    handlers.didFinishLaunching()
    await new Promise<void>(resolve => setImmediate(resolve))

    expect(signals.observe).toHaveBeenCalledTimes(1)
    expect(signals.observe).toHaveBeenCalledWith(fresh, false)
    expect(signals.noteReached).toHaveBeenCalledTimes(1)
    expect(signals.beginPoll).toHaveBeenCalledWith(false)

    handlers.shutdown()
  })

  it.each([
    ['a rejected link', new RefreshTokenInvalidError(), 'rejected'],
    ['a rejected session', new AuthenticationError('rejected'), 'rejected'],
    ['a refused app', new ForbiddenError('refused'), 'forbidden'],
    ['rejected credentials', new ConfigurationError('rejected key'), 'credentials'],
  ] as const)('pages %s from discovery and does not start the outage grace', async (_label, error, kind) => {
    mockGetLocations.mockRejectedValue(error)

    const { api, handlers } = makeApi()
    new ResideoPlatform(makeLog(), validConfig(true), api as unknown as API)
    handlers.didFinishLaunching()
    await new Promise<void>(resolve => setImmediate(resolve))

    expect(signals.noteAuth).toHaveBeenCalledWith(kind)
    expect(signals.noteOutage).not.toHaveBeenCalled()
    expect(signals.observe).not.toHaveBeenCalled()

    handlers.shutdown()
  })

  it.each([
    new ApiResponseError(404, 'missing'),
    new NetworkError('down'),
    new RateLimitError('slow'),
  ])('counts a discovery failure that is not sign-in as an outage', async (error) => {
    mockGetLocations.mockRejectedValue(error)

    const { api, handlers } = makeApi()
    new ResideoPlatform(makeLog(), validConfig(true), api as unknown as API)
    handlers.didFinishLaunching()
    await new Promise<void>(resolve => setImmediate(resolve))

    expect(signals.noteAuth).not.toHaveBeenCalled()
    expect(signals.noteOutage).toHaveBeenCalled()

    handlers.shutdown()
  })

  it('does not let a successful GET in the same poll clear a stopped sign-in', async () => {
    const wet = { ...leakDevice, deviceID: 'dev-1', waterPresent: true }
    const other = { ...leakDevice, deviceID: 'dev-2', waterPresent: false }
    mockGetLocations.mockResolvedValue([{ locationID: 1, devices: [wet, other] }])
    mockGetDetector.mockImplementation((id: string) => {
      if (id === 'dev-2') {
        return Promise.reject(new ForbiddenError('refused'))
      }
      return Promise.resolve(wet)
    })

    const { api, handlers } = makeApi()
    new ResideoPlatform(makeLog(), validConfig(true), api as unknown as API)
    handlers.didFinishLaunching()
    await new Promise<void>(resolve => setImmediate(resolve))

    expect(signals.noteAuth).toHaveBeenCalledTimes(1)
    expect(signals.noteAuth).toHaveBeenCalledWith('forbidden')
    expect(signals.noteReached).not.toHaveBeenCalled()
    expect(signals.noteCloudReached).toHaveBeenCalled()
    expect(signals.observe).toHaveBeenCalledWith(wet, false)

    handlers.shutdown()
  })

  it('clears a stopped sign-in on a later poll that gets a body and no auth error', async () => {
    jest.useFakeTimers()
    const body = { ...leakDevice, waterPresent: false }
    mockGetLocations.mockResolvedValue([{ locationID: 1, devices: [body] }])
    mockGetDetector.mockRejectedValueOnce(new AuthenticationError('rejected'))
    mockGetDetector.mockResolvedValue(body)

    const { api, handlers } = makeApi()
    new ResideoPlatform(makeLog(), validConfig(true), api as unknown as API)
    handlers.didFinishLaunching()
    await jest.advanceTimersByTimeAsync(0)

    expect(signals.noteAuth).toHaveBeenCalledWith('rejected')
    expect(signals.noteReached).not.toHaveBeenCalled()

    await jest.advanceTimersByTimeAsync(120_000)

    expect(signals.noteReached).toHaveBeenCalledTimes(1)
    expect(signals.beginPoll).toHaveBeenLastCalledWith(false)

    handlers.shutdown()
    jest.useRealTimers()
  })

  it('does not start the outage grace when the poll after a locations list fails open', async () => {
    mockGetLocations.mockResolvedValue([{ locationID: 1, devices: [leakDevice] }])
    mockGetDetector.mockRejectedValue(new RateLimitError('slow'))

    const { api, handlers } = makeApi()
    new ResideoPlatform(makeLog(), validConfig(true), api as unknown as API)
    handlers.didFinishLaunching()
    await new Promise<void>(resolve => setImmediate(resolve))

    expect(signals.noteReached).toHaveBeenCalledTimes(1)
    expect(signals.noteOutage).not.toHaveBeenCalled()
    expect(signals.noteAuth).not.toHaveBeenCalled()

    handlers.shutdown()
  })

  it('keeps an omitted detector in the published set until stale removal, then releases it', async () => {
    jest.useFakeTimers()
    jest.spyOn(Math, 'random').mockReturnValue(0.5)
    mockGetLocations.mockResolvedValue([{ locationID: 1, devices: [leakDevice] }])
    mockGetDetector.mockResolvedValue(leakDevice)

    const { api, handlers } = makeApi()
    const platform = new ResideoPlatform(makeLog(), validConfig(true), api as unknown as API)
    const stale = cachedAccessory({ ...leakDevice, deviceID: 'old-dev', userDefinedDeviceName: 'Old' })
    platform.configureAccessory(stale)

    handlers.didFinishLaunching()
    await jest.advanceTimersByTimeAsync(0)

    const firstSettle = signals.settle.mock.calls[0]?.[0] as string[]
    expect(firstSettle).toEqual(expect.arrayContaining(['dev-1', 'old-dev']))
    expect(signals.release).not.toHaveBeenCalled()

    await jest.advanceTimersByTimeAsync(15_000)
    expect(signals.release).not.toHaveBeenCalled()

    await jest.advanceTimersByTimeAsync(15_000)
    expect(signals.release).toHaveBeenCalledWith('old-dev', expect.not.arrayContaining(['old-dev']))
    const releasedIds = signals.release.mock.calls[0]?.[1] as string[]
    expect(releasedIds).toEqual(expect.arrayContaining(['dev-1']))

    handlers.shutdown()
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('does not recompute signals when a corrupt cached accessory is dropped', async () => {
    mockGetLocations.mockResolvedValue([])
    mockGetDetector.mockRejectedValue(new NetworkError('down'))

    const { api, handlers } = makeApi()
    const platform = new ResideoPlatform(makeLog(), validConfig(true), api as unknown as API)
    platform.configureAccessory(cachedAccessory(leakDevice))
    platform.configureAccessory({
      UUID: 'uuid-broken',
      displayName: 'Broken',
      context: { device: {} },
    } as unknown as PlatformAccessory)
    handlers.didFinishLaunching()
    await new Promise<void>(resolve => setImmediate(resolve))

    expect(api.unregisterPlatformAccessories).toHaveBeenCalled()
    expect(signals.release).not.toHaveBeenCalled()
    expect(signals.observe).not.toHaveBeenCalled()

    handlers.shutdown()
  })

  it('does not settle or clear auth from a locations list that arrives during a poll', async () => {
    let releaseGet: ((device: WaterLeakDetector) => void) | undefined
    const wet = { ...leakDevice, waterPresent: true }
    mockGetLocations.mockResolvedValue([{ locationID: 1, devices: [wet] }])
    mockGetDetector.mockReturnValue(new Promise<WaterLeakDetector>((resolve) => {
      releaseGet = resolve
    }))

    const { api, handlers } = makeApi()
    const platform = new ResideoPlatform(makeLog(), validConfig(true), api as unknown as API)
    handlers.didFinishLaunching()
    await new Promise<void>(resolve => setImmediate(resolve))

    const beginCalls = signals.beginPoll.mock.calls.length
    const settleCalls = signals.settle.mock.calls.length
    mockGetLocations.mockResolvedValue([{
      locationID: 1,
      devices: [{ ...wet, waterPresent: false }],
    }])
    await (platform as unknown as { discoverDevices: () => Promise<void> }).discoverDevices()

    expect(signals.beginPoll).toHaveBeenCalledTimes(beginCalls)
    expect(signals.settle).toHaveBeenCalledTimes(settleCalls)
    expect(signals.noteReached).not.toHaveBeenCalled()
    expect(signals.raiseOnly).toHaveBeenCalledWith(expect.objectContaining({ waterPresent: false }), false)

    releaseGet?.(wet)
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(signals.noteAuth).not.toHaveBeenCalled()

    handlers.shutdown()
  })
})
