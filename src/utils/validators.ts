/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Configuration validation. Validates the Homebridge platform
 * config at startup so misconfiguration fails fast with an actionable message
 * instead of surfacing as an opaque runtime error later.
 */

import { MIN_DIAGNOSTICS_INTERVAL_SEC, MIN_REFRESH_RATE_SEC } from '../settings'
import type { LeakDetectorOptions, ResideoPlatformConfig } from '../types'

/** Lowest plausible freeze threshold in Celsius (sanity bound). */
const MIN_FREEZE_THRESHOLD_C = -40
/** Highest plausible freeze threshold in Celsius (sanity bound). */
const MAX_FREEZE_THRESHOLD_C = 40

/**
 * Outcome of validating the platform config.
 *
 * `errors` are fatal — the plugin cannot start. `warnings` are non-fatal — the
 * plugin starts but a value was missing/out of range and a default was applied.
 */
export interface ConfigValidationResult {
  errors: string[]
  warnings: string[]
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** True when a freeze threshold is a real number within the plausible bounds. */
function isValidFreezeThreshold(value: number): boolean {
  return !Number.isNaN(value)
    && value >= MIN_FREEZE_THRESHOLD_C
    && value <= MAX_FREEZE_THRESHOLD_C
}

/**
 * Return a freeze threshold only when it is a usable number within the
 * plausible range, otherwise `undefined`. Callers fall back to the device's own
 * limit (or the plugin default), which is exactly what {@link validateConfig}
 * warns about for an out-of-range value, keeping the warning and the runtime
 * behavior in agreement.
 */
export function sanitizeFreezeThreshold(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !isValidFreezeThreshold(value)) {
    return undefined
  }
  return value
}

/**
 * Whether a per-device entry carries any actual override beyond its (here
 * missing) deviceID. An entirely empty row — e.g. one the settings UI adds and
 * the user never fills in — is silently ignored, while a row that configures
 * something but forgot its deviceID is a real mistake worth warning about.
 */
function hasMeaningfulDeviceOverride(device: LeakDetectorOptions | undefined): boolean {
  if (!device || typeof device !== 'object') {
    return false
  }
  return isNonEmptyString(device.name)
    || typeof device.freezeThresholdCelsius === 'number'
    || device.hideTemperatureSensor === true
    || device.hideHumiditySensor === true
    || device.enableFreezeSensor === true
}

/**
 * Build the warning(s) for a freeze-threshold value at a given config path. An
 * invalid (non-numeric or out-of-range) value is sanitized away at runtime by
 * {@link sanitizeFreezeThreshold}, so the "using the default instead" wording
 * is accurate.
 */
function freezeThresholdWarnings(value: unknown, path: string): string[] {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return [`${path} must be a number; using the default instead.`]
  }
  if (!isValidFreezeThreshold(value)) {
    return [`${path} ${value} is outside the plausible range `
      + `(${MIN_FREEZE_THRESHOLD_C}..${MAX_FREEZE_THRESHOLD_C}°C); using the default instead.`]
  }
  return []
}

/**
 * Validate the platform configuration block. Pure and side-effect free so it is
 * trivially unit-testable; the caller decides how to surface the results.
 */
export function validateConfig(config: ResideoPlatformConfig | undefined): ConfigValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  const credentials = config?.credentials
  if (!credentials || typeof credentials !== 'object') {
    errors.push('Missing "credentials". Open the plugin settings and link your Resideo account.')
    return { errors, warnings }
  }

  if (!isNonEmptyString(credentials.consumerKey)) {
    errors.push('credentials.consumerKey (API Key) is required.')
  }
  if (!isNonEmptyString(credentials.consumerSecret)) {
    errors.push('credentials.consumerSecret (API Secret) is required.')
  }
  if (!isNonEmptyString(credentials.refreshToken)) {
    errors.push('credentials.refreshToken is required. Re-link your account in the plugin settings.')
  }

  const options = config?.options
  if (options) {
    const { refreshRate, freezeThresholdCelsius, diagnosticsInterval, devices } = options

    if (refreshRate !== undefined) {
      if (typeof refreshRate !== 'number' || Number.isNaN(refreshRate)) {
        warnings.push('options.refreshRate must be a number; using the default instead.')
      } else if (refreshRate < MIN_REFRESH_RATE_SEC) {
        warnings.push(`options.refreshRate ${refreshRate}s is below the ${MIN_REFRESH_RATE_SEC}s minimum; it will be clamped.`)
      }
    }

    if (diagnosticsInterval !== undefined) {
      if (typeof diagnosticsInterval !== 'number' || Number.isNaN(diagnosticsInterval)) {
        warnings.push('options.diagnosticsInterval must be a number; diagnostics will be disabled.')
      } else if (diagnosticsInterval < 0) {
        warnings.push('options.diagnosticsInterval cannot be negative; diagnostics will be disabled.')
      } else if (diagnosticsInterval > 0 && diagnosticsInterval < MIN_DIAGNOSTICS_INTERVAL_SEC) {
        warnings.push(
          `options.diagnosticsInterval ${diagnosticsInterval}s is below the `
          + `${MIN_DIAGNOSTICS_INTERVAL_SEC}s minimum; it will be clamped.`,
        )
      }
    }

    if (freezeThresholdCelsius !== undefined) {
      warnings.push(...freezeThresholdWarnings(freezeThresholdCelsius, 'options.freezeThresholdCelsius'))
    }

    if (devices !== undefined) {
      if (!Array.isArray(devices)) {
        warnings.push('options.devices must be an array; per-device overrides ignored.')
      } else {
        devices.forEach((device, index) => {
          // Silently skip empty rows (e.g. a blank entry left by the settings
          // UI); only warn when an otherwise-configured override lacks the
          // deviceID it needs to apply.
          if (!isNonEmptyString(device?.deviceID) && hasMeaningfulDeviceOverride(device)) {
            warnings.push(`options.devices[${index}] is configured but missing a deviceID and will be ignored.`)
          }
          if (device?.freezeThresholdCelsius !== undefined) {
            warnings.push(
              ...freezeThresholdWarnings(device.freezeThresholdCelsius, `options.devices[${index}].freezeThresholdCelsius`),
            )
          }
        })
      }
    }
  }

  return { errors, warnings }
}
