/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import { validateConfig } from '../../src/utils'
import type { ResideoPlatformConfig } from '../../src/types'

function baseConfig(overrides: Partial<ResideoPlatformConfig> = {}): ResideoPlatformConfig {
  return {
    platform: 'MyResideo',
    credentials: {
      consumerKey: 'key',
      consumerSecret: 'secret',
      accessToken: 'access',
      refreshToken: 'refresh',
    },
    ...overrides,
  } as ResideoPlatformConfig
}

describe('validateConfig', () => {
  it('accepts a fully valid config', () => {
    const result = validateConfig(baseConfig())
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  it('errors when the config is undefined', () => {
    const result = validateConfig(undefined)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('errors when credentials are missing', () => {
    const result = validateConfig({ platform: 'MyResideo' } as ResideoPlatformConfig)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('credentials')
  })

  it('reports each missing credential field', () => {
    const result = validateConfig(baseConfig({
      credentials: { consumerKey: '', consumerSecret: '', accessToken: '', refreshToken: '' },
    }))
    expect(result.errors).toHaveLength(3)
  })

  it('warns when refreshRate is below the minimum', () => {
    const result = validateConfig(baseConfig({ options: { refreshRate: 5 } }))
    expect(result.errors).toHaveLength(0)
    expect(result.warnings.some(w => w.includes('refreshRate'))).toBe(true)
  })

  it('warns when refreshRate is not a number', () => {
    const result = validateConfig(baseConfig({
      options: { refreshRate: 'fast' as unknown as number },
    }))
    expect(result.warnings.some(w => w.includes('refreshRate'))).toBe(true)
  })

  it('warns when freezeThresholdCelsius is out of range', () => {
    const result = validateConfig(baseConfig({ options: { freezeThresholdCelsius: 999 } }))
    expect(result.warnings.some(w => w.includes('freezeThresholdCelsius'))).toBe(true)
  })

  it('warns when devices is not an array', () => {
    const result = validateConfig(baseConfig({
      options: { devices: {} as unknown as [] },
    }))
    expect(result.warnings.some(w => w.includes('devices'))).toBe(true)
  })

  it('warns when a configured device entry is missing a deviceID', () => {
    const result = validateConfig(baseConfig({
      options: { devices: [{ deviceID: '', enableFreezeSensor: true }] },
    }))
    expect(result.warnings.some(w => w.includes('deviceID'))).toBe(true)
  })

  it('silently ignores an empty device entry (e.g. a blank row from the settings UI)', () => {
    const result = validateConfig(baseConfig({
      options: { devices: [{ deviceID: '' }] },
    }))
    expect(result.warnings.some(w => w.includes('deviceID'))).toBe(false)
  })

  it('silently ignores an empty device entry whose booleans defaulted to false', () => {
    const result = validateConfig(baseConfig({
      options: {
        devices: [{
          deviceID: '',
          hideTemperatureSensor: false,
          hideHumiditySensor: false,
          enableFreezeSensor: false,
        }],
      },
    }))
    expect(result.warnings.some(w => w.includes('deviceID'))).toBe(false)
  })
})
