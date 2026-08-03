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
const mockRm = jest.fn()
const mockOpen = jest.fn()
// Handle returned by fs.open. The durable write path writes through the handle and
// fsyncs before closing, so tokens cannot be published by rename while still cached.
const mockHandleWriteFile = jest.fn()
const mockHandleSync = jest.fn()
const mockHandleClose = jest.fn()

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
    rm: mockRm,
    open: mockOpen,
  },
}))

import { ResideoApiClient, TokenManager } from '../../src/api'
import { LeakSensorAccessory } from '../../src/devices/leak-sensor'
import {
  ApiParseError,
  ApiResponseError,
  AuthenticationError,
  ForbiddenError,
  NetworkError,
  RefreshTokenInvalidError,
} from '../../src/errors'
import ResideoPlatform from '../../src/platform'
import {
  DEFAULT_REFRESH_RATE_SEC,
  MAX_DIAGNOSTICS_INTERVAL_SEC,
  MAX_REFRESH_RATE_SEC,
  MIN_DIAGNOSTICS_INTERVAL_SEC,
  MIN_REFRESH_RATE_SEC,
} from '../../src/settings'
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
    getStatus: () => ({ circuitBreaker: { state: 'CLOSED' } }),
  }));
  (TokenManager as unknown as jest.Mock).mockImplementation((opts: unknown) => ({ opts }));
  (LeakSensorAccessory as unknown as jest.Mock).mockImplementation((
    _platform: unknown,
    accessory: { displayName?: string },
    options?: { name?: string },
  ) => ({
    updateStatus: mockUpdateStatus,
    displayName: options?.name || accessory?.displayName || 'Water Leak Detector',
  }))
  mockGetLocations.mockReset()
  mockGetDetector.mockReset()
  mockUpdateStatus.mockReset()
  mockReadFile.mockReset()
  mockWriteFile.mockReset().mockResolvedValue(undefined)
  mockRename.mockReset().mockResolvedValue(undefined)
  mockRm.mockReset().mockResolvedValue(undefined)
  mockHandleWriteFile.mockReset().mockResolvedValue(undefined)
  mockHandleSync.mockReset().mockResolvedValue(undefined)
  mockHandleClose.mockReset().mockResolvedValue(undefined)
  mockOpen.mockReset().mockResolvedValue({
    writeFile: mockHandleWriteFile,
    sync: mockHandleSync,
    close: mockHandleClose,
  })
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

describe('poll cadence clamping', () => {
  // Both ends of the range collapse to a runaway timer: setInterval coerces NaN to
  // 0, and Node clamps any delay above 2^31-1 ms down to 1 ms. A config typo must
  // not turn into hundreds of API requests per second.
  const cadenceCases: Array<[string, unknown, number]> = [
    ['a sane value is used as-is', 300, 300_000],
    ['below the minimum is clamped up', 5, MIN_REFRESH_RATE_SEC * 1000],
    ['zero is clamped up', 0, MIN_REFRESH_RATE_SEC * 1000],
    ['negative is clamped up', -60, MIN_REFRESH_RATE_SEC * 1000],
    ['above the maximum is clamped down', MAX_REFRESH_RATE_SEC * 10, MAX_REFRESH_RATE_SEC * 1000],
    // Non-finite values carry no usable intent, so they take the default rather
    // than being clamped to a once-a-day cadence the user never asked for.
    ['Infinity falls back to the default', Infinity, DEFAULT_REFRESH_RATE_SEC * 1000],
    ['-Infinity falls back to the default', -Infinity, DEFAULT_REFRESH_RATE_SEC * 1000],
    ['NaN falls back to the default', NaN, DEFAULT_REFRESH_RATE_SEC * 1000],
    ['a string falls back to the default', 'fast', DEFAULT_REFRESH_RATE_SEC * 1000],
  ]

  it.each(cadenceCases)('refreshRate: %s', (_label, refreshRate, expectedMs) => {
    const { api } = makeApi()
    const platform = new ResideoPlatform(
      makeLog(),
      { ...validConfig(), options: { refreshRate: refreshRate as number } },
      api as unknown as API,
    )

    const actual = (platform as unknown as { refreshRateMs: number }).refreshRateMs
    expect(actual).toBe(expectedMs)
    // Whatever the input, the result must be a delay setInterval can represent.
    expect(Number.isFinite(actual)).toBe(true)
    expect(actual).toBeLessThanOrEqual(2 ** 31 - 1)
  })

  const diagnosticsCases: Array<[string, unknown, number]> = [
    ['zero disables diagnostics', 0, 0],
    ['negative disables diagnostics', -5, 0],
    // Diagnostics are opt-in, so an unusable value leaves them off.
    ['Infinity disables diagnostics', Infinity, 0],
    ['NaN disables diagnostics', NaN, 0],
    ['above the maximum is clamped down', MAX_DIAGNOSTICS_INTERVAL_SEC + 1, MAX_DIAGNOSTICS_INTERVAL_SEC * 1000],
    ['below the minimum is clamped up', 5, MIN_DIAGNOSTICS_INTERVAL_SEC * 1000],
    ['a sane value is used as-is', 300, 300_000],
  ]

  it.each(diagnosticsCases)('diagnosticsInterval: %s', (_label, diagnosticsInterval, expectedMs) => {
    const { api } = makeApi()
    const platform = new ResideoPlatform(
      makeLog(),
      { ...validConfig(), options: { diagnosticsInterval: diagnosticsInterval as number } },
      api as unknown as API,
    )

    const internal = platform as unknown as { diagnosticsIntervalMs: () => number }
    expect(internal.diagnosticsIntervalMs()).toBe(expectedMs)
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

  it('unregisters a stale detector only after repeated non-empty discoveries omit it', async () => {
    jest.useFakeTimers()
    jest.spyOn(Math, 'random').mockReturnValue(0.5)
    mockGetLocations.mockResolvedValue([{ locationID: 1, devices: [leakDevice] }])
    mockGetDetector.mockResolvedValue(leakDevice)

    const log = makeLog()
    const { api, handlers } = makeApi()
    const platform = new ResideoPlatform(log, validConfig(), api as unknown as API)

    const stale = {
      UUID: 'uuid-old',
      displayName: 'Old Detector',
      context: { device: { deviceID: 'old-dev' }, locationId: 1 },
    } as unknown as PlatformAccessory
    platform.configureAccessory(stale)

    handlers.didFinishLaunching()
    await jest.advanceTimersByTimeAsync(0)
    expect(api.unregisterPlatformAccessories).not.toHaveBeenCalled()
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('1/3'))

    await jest.advanceTimersByTimeAsync(15_000)
    expect(api.unregisterPlatformAccessories).not.toHaveBeenCalled()
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('2/3'))

    await jest.advanceTimersByTimeAsync(15_000)
    expect(api.unregisterPlatformAccessories).toHaveBeenCalledWith(
      'homebridge-myresideo',
      'MyResideo',
      [stale],
    )

    handlers.shutdown()
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('does not remove missing detectors while the circuit breaker is open', async () => {
    jest.useFakeTimers()
    jest.spyOn(Math, 'random').mockReturnValue(0.5)
    mockGetLocations.mockResolvedValue([{ locationID: 1, devices: [leakDevice] }])
    mockGetDetector.mockResolvedValue(leakDevice);
    (ResideoApiClient as unknown as jest.Mock).mockImplementation(() => ({
      getLocations: mockGetLocations,
      getWaterLeakDetector: mockGetDetector,
      getStatus: () => ({ circuitBreaker: { state: 'OPEN' } }),
    }))

    const log = makeLog()
    const { api, handlers } = makeApi()
    const platform = new ResideoPlatform(log, validConfig(), api as unknown as API)
    platform.configureAccessory({
      UUID: 'uuid-old',
      displayName: 'Old Detector',
      context: { device: { deviceID: 'old-dev' }, locationId: 1 },
    } as unknown as PlatformAccessory)

    handlers.didFinishLaunching()
    await jest.advanceTimersByTimeAsync(0)

    expect(api.unregisterPlatformAccessories).not.toHaveBeenCalled()
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('platform is unstable'))
    expect(log.warn).not.toHaveBeenCalledWith(expect.stringContaining('1/3'))

    await jest.advanceTimersByTimeAsync(15_000)
    expect(api.unregisterPlatformAccessories).not.toHaveBeenCalled()

    handlers.shutdown()
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('does not prune on a single partial discovery during an outage', async () => {
    jest.useFakeTimers()
    jest.spyOn(Math, 'random').mockReturnValue(0.5)
    const kept = leakDevice
    const missing: WaterLeakDetector = {
      deviceID: 'dev-2',
      deviceClass: 'LeakDetector',
      deviceType: 'Water Leak Detector',
      waterPresent: false,
      userDefinedDeviceName: 'Laundry',
    }
    mockGetLocations
      .mockResolvedValueOnce([{ locationID: 1, devices: [kept] }])
      .mockResolvedValueOnce([{ locationID: 1, devices: [kept, missing] }])
    mockGetDetector.mockImplementation(async (id: string) => (id === 'dev-2' ? missing : kept))

    const log = makeLog()
    const { api, handlers } = makeApi()
    const platform = new ResideoPlatform(log, validConfig(), api as unknown as API)

    platform.configureAccessory({
      UUID: 'uuid-myresideo-dev-1',
      displayName: 'Kitchen',
      context: { device: { ...kept }, locationId: 1 },
    } as unknown as PlatformAccessory)
    platform.configureAccessory({
      UUID: 'uuid-myresideo-dev-2',
      displayName: 'Laundry',
      context: { device: { ...missing }, locationId: 1 },
    } as unknown as PlatformAccessory)

    handlers.didFinishLaunching()
    await jest.advanceTimersByTimeAsync(0)

    expect(api.unregisterPlatformAccessories).not.toHaveBeenCalled()
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('not removing yet'))

    await jest.advanceTimersByTimeAsync(15_000)
    expect(api.unregisterPlatformAccessories).not.toHaveBeenCalled()
    expect(mockGetLocations).toHaveBeenCalledTimes(2)

    handlers.shutdown()
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('prunes cached accessories missing a deviceID', async () => {
    mockGetLocations.mockResolvedValue([{ locationID: 1, devices: [leakDevice] }])
    mockGetDetector.mockResolvedValue(leakDevice)

    const log = makeLog()
    const { api, handlers } = makeApi()
    const platform = new ResideoPlatform(log, validConfig(), api as unknown as API)

    const corrupt = {
      UUID: 'uuid-corrupt',
      displayName: 'Corrupt Detector',
      context: { device: {} },
    } as unknown as PlatformAccessory
    platform.configureAccessory(corrupt)

    handlers.didFinishLaunching()
    await flush()

    expect(api.unregisterPlatformAccessories).toHaveBeenCalledWith(
      'homebridge-myresideo',
      'MyResideo',
      [corrupt],
    )
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('without a deviceID'),
    )

    handlers.shutdown()
  })

  it('stops polling a corrupt accessory it unregistered', async () => {
    // A pruned accessory whose cached record lost its deviceID must still release
    // its handler/location entries. Otherwise the plugin keeps polling a detector
    // that no longer exists in HomeKit and the device gauges stay wrong forever.
    mockGetLocations.mockResolvedValue([{ locationID: 1, devices: [leakDevice] }])
    mockGetDetector.mockResolvedValue(leakDevice)

    const log = makeLog()
    const { api, handlers } = makeApi()
    const platform = new ResideoPlatform(log, validConfig(), api as unknown as API)

    handlers.didFinishLaunching()
    await flush()

    const internal = platform as unknown as {
      handlers: Map<string, unknown>
      locationByDevice: Map<string, number>
      pruneCorruptAccessories: () => void
    }
    expect(internal.handlers.has('dev-1')).toBe(true)

    // Simulate the cached record losing its deviceID, then prune.
    platform.accessories[0].context.device = {}
    internal.pruneCorruptAccessories()

    expect(api.unregisterPlatformAccessories).toHaveBeenCalled()
    expect(internal.handlers.has('dev-1')).toBe(false)
    expect(internal.locationByDevice.has('dev-1')).toBe(false)

    // Nothing left to poll, so no further device requests are issued.
    mockGetDetector.mockClear()
    await (platform as unknown as { runPollCycle: () => Promise<void> }).runPollCycle()
    expect(mockGetDetector).not.toHaveBeenCalled()

    handlers.shutdown()
  })

  it('skips a discovered detector that has no deviceID', async () => {
    // Registering it would mint an accessory that pruneCorruptAccessories then
    // deletes, so it is skipped up front with an explanation instead.
    mockGetLocations.mockResolvedValue([{
      locationID: 42,
      devices: [
        { deviceClass: 'LeakDetector', deviceType: 'Water Leak Detector', waterPresent: false },
        leakDevice,
      ],
    }])
    mockGetDetector.mockResolvedValue(leakDevice)

    const log = makeLog()
    const { api, handlers } = makeApi()
    new ResideoPlatform(log, validConfig(), api as unknown as API)

    handlers.didFinishLaunching()
    await flush()

    expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(1)
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Discovered 1 water leak detector'))
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('without a deviceID'))
    expect(api.unregisterPlatformAccessories).not.toHaveBeenCalled()

    handlers.shutdown()
  })

  it('does not wipe cached detectors when discovery returns an empty cloud list', async () => {
    jest.useFakeTimers()
    jest.spyOn(Math, 'random').mockReturnValue(0.5)
    mockGetLocations
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ locationID: 1293395, devices: [leakDevice] }])
    mockGetDetector.mockResolvedValue(leakDevice)

    const log = makeLog()
    const { api, handlers } = makeApi()
    const platform = new ResideoPlatform(log, validConfig(), api as unknown as API)

    const cached = {
      UUID: 'uuid-myresideo-dev-1',
      displayName: 'Kitchen Sink LD',
      context: { device: { ...leakDevice }, locationId: 1293395 },
    } as unknown as PlatformAccessory
    platform.configureAccessory(cached)

    handlers.didFinishLaunching()
    await jest.advanceTimersByTimeAsync(0)

    expect(api.unregisterPlatformAccessories).not.toHaveBeenCalled()
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('skipping stale removal'))
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Retrying device discovery'))
    // Restored from cache so polling can continue during the outage.
    expect(LeakSensorAccessory).toHaveBeenCalled()
    expect(mockGetDetector).toHaveBeenCalledWith('dev-1', 1293395)

    await jest.advanceTimersByTimeAsync(15_000)
    expect(mockGetLocations).toHaveBeenCalledTimes(2)
    expect(api.unregisterPlatformAccessories).not.toHaveBeenCalled()

    handlers.shutdown()
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('retries empty discovery even with no cached accessories until devices return', async () => {
    jest.useFakeTimers()
    jest.spyOn(Math, 'random').mockReturnValue(0.5)
    mockGetLocations
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ locationID: 1, devices: [leakDevice] }])
    mockGetDetector.mockResolvedValue(leakDevice)

    const log = makeLog()
    const { api, handlers } = makeApi()
    new ResideoPlatform(log, validConfig(), api as unknown as API)

    handlers.didFinishLaunching()
    await jest.advanceTimersByTimeAsync(0)

    expect(api.registerPlatformAccessories).not.toHaveBeenCalled()
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('transient empty cloud response'))
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Retrying device discovery'))

    await jest.advanceTimersByTimeAsync(15_000)
    expect(mockGetLocations).toHaveBeenCalledTimes(2)
    expect(api.registerPlatformAccessories).not.toHaveBeenCalled()

    await jest.advanceTimersByTimeAsync(30_000)
    expect(mockGetLocations).toHaveBeenCalledTimes(3)
    expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(1)

    handlers.shutdown()
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('demotes repeated empty-discovery logs to debug after a one-line quiet status', async () => {
    jest.useFakeTimers()
    jest.spyOn(Math, 'random').mockReturnValue(0.5)
    mockGetLocations.mockResolvedValue([])

    const log = makeLog()
    const { api, handlers } = makeApi()
    new ResideoPlatform(log, validConfig(), api as unknown as API)

    handlers.didFinishLaunching()
    await jest.advanceTimersByTimeAsync(0) // attempt becomes 1
    await jest.advanceTimersByTimeAsync(15_000) // 2
    await jest.advanceTimersByTimeAsync(30_000) // 3
    const warnsBeforeQuiet = (log.warn as jest.Mock).mock.calls.length
    const infosBeforeQuiet = (log.info as jest.Mock).mock.calls.length

    await jest.advanceTimersByTimeAsync(60_000) // attempt 3 at discover → quiet + status
    expect(log.warn).toHaveBeenCalledTimes(warnsBeforeQuiet)
    expect(log.info).toHaveBeenCalledWith('Retrying discovery every 300s (next message upon recovery)')
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('Discovered 0'))
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('transient empty cloud response'))
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('Retrying device discovery'))

    await jest.advanceTimersByTimeAsync(300_000) // still empty — no more info spam
    expect(log.info).toHaveBeenCalledTimes(infosBeforeQuiet + 1)

    handlers.shutdown()
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('logs poll failures at debug with the detector name and does not error', async () => {
    mockGetLocations.mockResolvedValue([{ locationID: 1, devices: [leakDevice] }])
    mockGetDetector.mockRejectedValue(new ApiResponseError(500, 'API request failed: 500'))

    const log = makeLog()
    const { api, handlers } = makeApi()
    new ResideoPlatform(log, validConfig(), api as unknown as API)

    handlers.didFinishLaunching()
    await flush()

    expect(log.debug).toHaveBeenCalledWith(
      expect.stringContaining('Polling skipped for Water Leak Detector: API request failed: 500'),
    )
    expect(log.error).not.toHaveBeenCalledWith(expect.stringContaining('poll'))
    expect(log.error).not.toHaveBeenCalledWith(expect.stringContaining('API request failed'))

    handlers.shutdown()
  })

  it('surfaces a refresh-token failure during polling once at error (not debug-only)', async () => {
    mockGetLocations.mockResolvedValue([{ locationID: 1, devices: [leakDevice] }])
    mockGetDetector.mockRejectedValue(new RefreshTokenInvalidError())

    const log = makeLog()
    const { api, handlers } = makeApi()
    new ResideoPlatform(log, validConfig(), api as unknown as API)

    handlers.didFinishLaunching()
    await flush()

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Re-link'))
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('[poll]'))

    handlers.shutdown()
  })

  it('surfaces a forbidden poll failure with permissions guidance', async () => {
    mockGetLocations.mockResolvedValue([{ locationID: 1, devices: [leakDevice] }])
    mockGetDetector.mockRejectedValue(new ForbiddenError('forbidden'))

    const log = makeLog()
    const { api, handlers } = makeApi()
    new ResideoPlatform(log, validConfig(), api as unknown as API)

    handlers.didFinishLaunching()
    await flush()

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('HTTP 403'))
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('authorized'))

    handlers.shutdown()
  })

  it('surfaces a generic auth poll failure with re-link guidance', async () => {
    mockGetLocations.mockResolvedValue([{ locationID: 1, devices: [leakDevice] }])
    mockGetDetector.mockRejectedValue(new AuthenticationError('API request failed: 401'))

    const log = makeLog()
    const { api, handlers } = makeApi()
    new ResideoPlatform(log, validConfig(), api as unknown as API)

    handlers.didFinishLaunching()
    await flush()

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Authentication failed'))
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Re-link'))

    handlers.shutdown()
  })

  it('logs an actionable poll auth failure only once across multiple detectors', async () => {
    const second: WaterLeakDetector = { ...leakDevice, deviceID: 'dev-2' }
    mockGetLocations.mockResolvedValue([{ locationID: 1, devices: [leakDevice, second] }])
    mockGetDetector.mockRejectedValue(new RefreshTokenInvalidError())

    const log = makeLog()
    const { api, handlers } = makeApi()
    new ResideoPlatform(log, validConfig(), api as unknown as API)

    handlers.didFinishLaunching()
    await flush()

    const reLinkCalls = (log.error as jest.Mock).mock.calls
      .map(args => args[0] as string)
      .filter(line => typeof line === 'string' && line.includes('Re-link'))
    expect(reLinkCalls).toHaveLength(1)

    handlers.shutdown()
  })

  it('re-surfaces a poll auth failure on a later cycle (once per cycle)', async () => {
    jest.useFakeTimers()
    try {
      mockGetLocations.mockResolvedValue([{ locationID: 1, devices: [leakDevice] }])
      mockGetDetector.mockRejectedValue(new RefreshTokenInvalidError())

      const log = makeLog()
      const { api, handlers } = makeApi()
      new ResideoPlatform(log, validConfig(), api as unknown as API)

      handlers.didFinishLaunching()
      await jest.advanceTimersByTimeAsync(0) // discovery + immediate poll

      const countReLink = () => (log.error as jest.Mock).mock.calls
        .map(args => args[0] as string)
        .filter(line => typeof line === 'string' && line.includes('Re-link')).length

      expect(countReLink()).toBe(1)

      await jest.advanceTimersByTimeAsync(DEFAULT_REFRESH_RATE_SEC * 1000)
      expect(countReLink()).toBe(2)

      handlers.shutdown()
    } finally {
      jest.useRealTimers()
    }
  })

  it('wires the circuit-breaker trip hook into diagnostics', () => {
    const log = makeLog()
    const { api } = makeApi()
    new ResideoPlatform(log, validConfig(), api as unknown as API)

    const clientOpts = (ResideoApiClient as unknown as jest.Mock).mock.calls[0][0] as {
      onCircuitOpen?: () => void
    }
    expect(typeof clientOpts.onCircuitOpen).toBe('function')
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
    jest.restoreAllMocks()
  })

  it('retries discovery with backoff after a transient failure', async () => {
    jest.useFakeTimers()
    // Pin jitter so the first discovery retry is exactly the 15s base.
    jest.spyOn(Math, 'random').mockReturnValue(0.5)
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

  it('retries discovery after a one-off unparseable payload', async () => {
    jest.useFakeTimers()
    jest.spyOn(Math, 'random').mockReturnValue(0.5)
    mockGetLocations
      .mockRejectedValueOnce(new ApiParseError('bad json'))
      .mockResolvedValue([{ locationID: 1, devices: [leakDevice] }])
    mockGetDetector.mockResolvedValue(leakDevice)

    const log = makeLog()
    const { api, handlers } = makeApi()
    new ResideoPlatform(log, validConfig(), api as unknown as API)

    handlers.didFinishLaunching()
    await jest.advanceTimersByTimeAsync(0)
    expect(mockGetLocations).toHaveBeenCalledTimes(1)
    expect(log.error).not.toHaveBeenCalledWith(expect.stringContaining('non-recoverable'))

    await jest.advanceTimersByTimeAsync(15_000)
    expect(mockGetLocations).toHaveBeenCalledTimes(2)
    expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(1)

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
  /**
   * Mirror durable writes into subsequent reads so the post-promote verify step
   * sees the tokens that were just written (as a real filesystem would).
   */
  function mirrorConfigOnDisk(initialJson: string): void {
    let onDisk = initialJson
    mockReadFile.mockImplementation(async () => onDisk)
    mockHandleWriteFile.mockImplementation(async (content: string) => {
      onDisk = content
    })
  }

  it('writes the rotated token atomically (temp file + rename)', async () => {
    mirrorConfigOnDisk(JSON.stringify({
      platforms: [{ platform: 'MyResideo', name: 'MyResideo', credentials: { refreshToken: 'old' } }],
    }))
    mockRename.mockResolvedValue(undefined)

    const log = makeLog()
    const { api } = makeApi()
    new ResideoPlatform(log, validConfig(), api as unknown as API)

    const tokenOpts = (TokenManager as unknown as jest.Mock).mock.calls[0][0] as {
      onRefreshToken: (tokens: { refreshToken: string, accessToken: string }) => Promise<void>
    }
    await tokenOpts.onRefreshToken({ refreshToken: 'rotated-token', accessToken: 'access-new' })

    expect(mockOpen).toHaveBeenCalledTimes(1)
    const [tempPath] = mockOpen.mock.calls[0] as [string, string]
    expect(tempPath).toMatch(/\.tmp$/)
    const [content] = mockHandleWriteFile.mock.calls[0] as [string, string]
    expect(content).toContain('rotated-token')
    expect(content).toContain('access-new')
    // fsync before the rename publishes it, so a crash cannot expose a truncated
    // config; the handle is always closed.
    expect(mockHandleSync).toHaveBeenCalledTimes(1)
    expect(mockHandleClose).toHaveBeenCalledTimes(1)
    expect(mockRename).toHaveBeenCalledWith(tempPath, '/tmp/config.json')
    expect(mockRm).not.toHaveBeenCalled()
  })

  it('retries when a concurrent save overwrites the new tokens before they are confirmed', async () => {
    const initial = JSON.stringify({
      platforms: [{ platform: 'MyResideo', name: 'MyResideo', credentials: { refreshToken: 'old' } }],
    })
    let onDisk = initial
    let writes = 0
    mockReadFile.mockImplementation(async () => onDisk)
    mockHandleWriteFile.mockImplementation(async (content: string) => {
      writes++
      // First promote is "clobbered" by Config UI X (verify still sees old tokens).
      // Second write sticks.
      if (writes >= 2) {
        onDisk = content
      }
    })
    mockRename.mockResolvedValue(undefined)

    const log = makeLog()
    const { api } = makeApi()
    new ResideoPlatform(log, validConfig(), api as unknown as API)

    const tokenOpts = (TokenManager as unknown as jest.Mock).mock.calls[0][0] as {
      onRefreshToken: (tokens: { refreshToken: string, accessToken: string }) => Promise<void>
    }
    await tokenOpts.onRefreshToken({ refreshToken: 'rotated-token', accessToken: 'access-new' })

    expect(writes).toBe(2)
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('overwritten before it could be confirmed'))
    expect(onDisk).toContain('rotated-token')
  })

  it('closes the handle and reports the failure when the fsync fails', async () => {
    mirrorConfigOnDisk(JSON.stringify({
      platforms: [{ platform: 'MyResideo', name: 'MyResideo', credentials: { refreshToken: 'old' } }],
    }))
    mockHandleSync.mockRejectedValue(new Error('sync failed'))

    const log = makeLog()
    const { api } = makeApi()
    new ResideoPlatform(log, validConfig(), api as unknown as API)

    const tokenOpts = (TokenManager as unknown as jest.Mock).mock.calls[0][0] as {
      onRefreshToken: (tokens: { refreshToken: string, accessToken: string }) => Promise<void>
    }
    // Never throws: the refresh itself already succeeded.
    await expect(
      tokenOpts.onRefreshToken({ refreshToken: 'rotated-token', accessToken: 'access-new' }),
    ).resolves.toBeUndefined()

    expect(mockHandleClose).toHaveBeenCalledTimes(1)
    // The un-synced temp file is never promoted over the live config.
    expect(mockRename).not.toHaveBeenCalled()
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Could not persist tokens'))
  })

  it('replaces config via rename-aside when rename cannot overwrite (Windows)', async () => {
    mirrorConfigOnDisk(JSON.stringify({
      platforms: [{ platform: 'MyResideo', name: 'MyResideo', credentials: { refreshToken: 'old' } }],
    }))
    const eexist = Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
    mockRename
      .mockRejectedValueOnce(eexist)
      .mockResolvedValue(undefined)
    mockRm.mockResolvedValue(undefined)

    const log = makeLog()
    const { api } = makeApi()
    new ResideoPlatform(log, validConfig(), api as unknown as API)

    const tokenOpts = (TokenManager as unknown as jest.Mock).mock.calls[0][0] as {
      onRefreshToken: (tokens: { refreshToken: string, accessToken: string }) => Promise<void>
    }
    await tokenOpts.onRefreshToken({ refreshToken: 'rotated-token', accessToken: 'access-new' })

    const [tempPath] = mockOpen.mock.calls[0] as [string, string]
    // 1) temp → config (fails EEXIST), 2) config → backup, 3) temp → config
    expect(mockRename).toHaveBeenNthCalledWith(1, tempPath, '/tmp/config.json')
    expect(mockRename.mock.calls[1][0]).toBe('/tmp/config.json')
    expect(mockRename.mock.calls[1][1]).toMatch(/\.bak$/)
    expect(mockRename).toHaveBeenNthCalledWith(3, tempPath, '/tmp/config.json')
    expect(mockRm).toHaveBeenCalledWith(expect.stringMatching(/\.bak$/), { force: true })
  })

  it('restores the backup if Windows promote fails after rename-aside', async () => {
    mirrorConfigOnDisk(JSON.stringify({
      platforms: [{ platform: 'MyResideo', name: 'MyResideo', credentials: { refreshToken: 'old' } }],
    }))
    const eexist = Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
    const promoteFail = new Error('promote failed')
    mockRename
      .mockRejectedValueOnce(eexist)
      .mockResolvedValueOnce(undefined) // config → backup
      .mockRejectedValueOnce(promoteFail) // temp → config
      .mockResolvedValueOnce(undefined) // backup → config (restore)

    const log = makeLog()
    const { api } = makeApi()
    new ResideoPlatform(log, validConfig(), api as unknown as API)

    const tokenOpts = (TokenManager as unknown as jest.Mock).mock.calls[0][0] as {
      onRefreshToken: (tokens: { refreshToken: string, accessToken: string }) => Promise<void>
    }
    await tokenOpts.onRefreshToken({ refreshToken: 'rotated-token', accessToken: 'access-new' })

    const backupPath = mockRename.mock.calls[1][1] as string
    expect(backupPath).toMatch(/\.bak$/)
    expect(mockRename).toHaveBeenNthCalledWith(4, backupPath, '/tmp/config.json')
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Could not persist'))
    expect(mockRm).not.toHaveBeenCalled()
  })

  it('does not throw when persistence fails', async () => {
    mockReadFile.mockRejectedValue(new Error('disk gone'))

    const log = makeLog()
    const { api } = makeApi()
    new ResideoPlatform(log, validConfig(), api as unknown as API)

    const tokenOpts = (TokenManager as unknown as jest.Mock).mock.calls[0][0] as {
      onRefreshToken: (tokens: { refreshToken: string, accessToken: string }) => Promise<void>
    }
    await expect(
      tokenOpts.onRefreshToken({ refreshToken: 'rotated-token', accessToken: 'access-new' }),
    ).resolves.toBeUndefined()
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Could not persist'))
  })

  it('refuses to persist when multiple platform blocks share the same name', async () => {
    mirrorConfigOnDisk(JSON.stringify({
      platforms: [
        { platform: 'MyResideo', name: 'MyResideo', credentials: { refreshToken: 'old-a' } },
        { platform: 'MyResideo', name: 'MyResideo', credentials: { refreshToken: 'old-b' } },
      ],
    }))

    const log = makeLog()
    const { api } = makeApi()
    new ResideoPlatform(log, validConfig(), api as unknown as API)

    const tokenOpts = (TokenManager as unknown as jest.Mock).mock.calls[0][0] as {
      onRefreshToken: (tokens: { refreshToken: string, accessToken: string }) => Promise<void>
    }
    await tokenOpts.onRefreshToken({ refreshToken: 'rotated-token', accessToken: 'access-new' })

    expect(mockOpen).not.toHaveBeenCalled()
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('unique "name"'))
  })

  it('refuses to persist when no platform block matches this instance name', async () => {
    mirrorConfigOnDisk(JSON.stringify({
      platforms: [
        { platform: 'MyResideo', name: 'Kitchen', credentials: { refreshToken: 'old-a' } },
        { platform: 'MyResideo', name: 'Garage', credentials: { refreshToken: 'old-b' } },
      ],
    }))

    const log = makeLog()
    const { api } = makeApi()
    new ResideoPlatform(log, validConfig(), api as unknown as API)

    const tokenOpts = (TokenManager as unknown as jest.Mock).mock.calls[0][0] as {
      onRefreshToken: (tokens: { refreshToken: string, accessToken: string }) => Promise<void>
    }
    await tokenOpts.onRefreshToken({ refreshToken: 'rotated-token', accessToken: 'access-new' })

    expect(mockOpen).not.toHaveBeenCalled()
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('no MyResideo platform block matches'))
    expect(log.error).not.toHaveBeenCalledWith(expect.stringContaining('share the same name'))
  })

  it('selects the block matching this instance name when several blocks exist', async () => {
    mirrorConfigOnDisk(JSON.stringify({
      platforms: [
        { platform: 'MyResideo', name: 'Other', credentials: { refreshToken: 'old-other' } },
        { platform: 'MyResideo', name: 'MyResideo', credentials: { refreshToken: 'old-mine' } },
      ],
    }))

    const log = makeLog()
    const { api } = makeApi()
    new ResideoPlatform(log, validConfig(), api as unknown as API)

    const tokenOpts = (TokenManager as unknown as jest.Mock).mock.calls[0][0] as {
      onRefreshToken: (tokens: { refreshToken: string, accessToken: string }) => Promise<void>
    }
    await tokenOpts.onRefreshToken({ refreshToken: 'rotated-token', accessToken: 'access-new' })

    const [content] = mockHandleWriteFile.mock.calls[0] as [string, string]
    const written = JSON.parse(content) as { platforms: ResideoPlatformConfig[] }
    expect(written.platforms[0].credentials.refreshToken).toBe('old-other')
    expect(written.platforms[1].credentials.refreshToken).toBe('rotated-token')
    expect(written.platforms[1].credentials.accessToken).toBe('access-new')
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
    // Sibling shape: devices | rest <state> | api p50/p95 (req, err). Leak and
    // breaker only appear when they carry signal; token expiry stays in JSON.
    expect(healthLine).toContain('devices ')
    expect(healthLine).toMatch(/rest (live|connecting|stopped|auth-failed)/)
    expect(healthLine).toContain('rest live')
    expect(healthLine).toMatch(/api p50 \d+ms p95 \d+ms \(req \d+, err \d+\)/)
    expect(healthLine).not.toContain('latency p50')
    expect(healthLine).not.toContain('breaker ')
    expect(healthLine).not.toContain(' leak')
    expect(healthLine).not.toContain('token exp')
    expect(healthLine).not.toMatch(/\bpoll\b/)
    expect(healthLine).not.toContain('retried')

    handlers.shutdown()
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Diagnostics stop'))
  })

  it('surfaces an active leak and a non-CLOSED breaker on the health line', async () => {
    jest.useFakeTimers()
    stubTokenManagerWithStatus()
    const leaking = { ...leakDevice, waterPresent: true }
    mockGetLocations.mockResolvedValue([{ locationID: 1, devices: [leaking] }])
    mockGetDetector.mockResolvedValue(leaking);
    (ResideoApiClient as unknown as jest.Mock).mockImplementation(() => ({
      getLocations: mockGetLocations,
      getWaterLeakDetector: mockGetDetector,
      getStatus: () => ({ circuitBreaker: { state: 'OPEN' } }),
    }))

    const log = makeLog()
    const { api, handlers } = makeApi()
    new ResideoPlatform(log, diagnosticsConfig(), api as unknown as API)

    handlers.didFinishLaunching()
    await jest.advanceTimersByTimeAsync(0)
    // Boot poll writes the leak into accessory context so the gauges see it.
    await jest.advanceTimersByTimeAsync(0)

    const startLine = (log.info as jest.Mock).mock.calls
      .map(args => args[0] as string)
      .find(line => typeof line === 'string' && line.includes('Diagnostics start'))
    expect(startLine).toContain('(1 leak)')
    expect(startLine).toContain('breaker OPEN')
    expect(startLine).toContain('api p50')
    expect(startLine).not.toContain('token exp')

    handlers.shutdown()
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
    const parsed = JSON.parse(jsonLine as string) as {
      msg: string
      lifecycle: { health: string }
      circuitBreaker: { state: string }
    }
    expect(parsed.circuitBreaker.state).toBe('CLOSED')
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
