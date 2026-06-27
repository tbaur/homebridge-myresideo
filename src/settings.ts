/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Plugin-wide constants and Resideo / Honeywell Home API endpoints.
 */

/** Name used to register the plugin with Homebridge (must match package.json name). */
export const PLUGIN_NAME = 'homebridge-myresideo'

/** Platform identifier referenced in the user's Homebridge config. */
export const PLATFORM_NAME = 'MyResideo'

/** Prefix used when generating stable HAP accessory UUIDs. */
export const UUID_PREFIX = 'myresideo-'

/**
 * Base host for the Resideo / Honeywell Home API.
 *
 * The legacy `api.honeywell.com` host has been deprecated by Resideo and its
 * certificate retired, which is what broke the original plugin. All requests
 * must target `api.honeywellhome.com`.
 *
 * @see https://developer.honeywellhome.com
 */
export const API_BASE_URL = 'https://api.honeywellhome.com'

/** OAuth2 authorize endpoint (browser redirect target). */
export const AUTHORIZE_URL = `${API_BASE_URL}/oauth2/authorize`

/** OAuth2 token endpoint (authorization_code exchange and refresh_token). */
export const TOKEN_URL = `${API_BASE_URL}/oauth2/token`

/** Returns all locations (and their devices) for the authenticated user. */
export const LOCATIONS_URL = `${API_BASE_URL}/v2/locations`

/** Base path for device resources. Append `/{deviceType}` and `/{deviceId}`. */
export const DEVICES_URL = `${API_BASE_URL}/v2/devices`

/** Device-type path segment for WiFi Water Leak & Freeze Detectors. */
export const WATER_LEAK_DETECTOR_TYPE = 'waterLeakDetectors'

/** Honeywell `deviceClass` value identifying a water leak detector. */
export const LEAK_DETECTOR_DEVICE_CLASS = 'LeakDetector'

/** Default polling interval (seconds) for refreshing device status. */
export const DEFAULT_REFRESH_RATE_SEC = 120

/** Minimum allowed polling interval (seconds) to avoid hammering the API. */
export const MIN_REFRESH_RATE_SEC = 30

/** Default request timeout (ms) for API calls. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

/**
 * Refresh the access token this many milliseconds before it actually expires,
 * so an in-flight poll never races a token expiry.
 */
export const TOKEN_REFRESH_BUFFER_MS = 60_000

/** Fallback access-token lifetime (seconds) when the API omits `expires_in`. */
export const DEFAULT_TOKEN_TTL_SEC = 1799

/** Battery percentage at or below which HomeKit reports "low battery". */
export const LOW_BATTERY_THRESHOLD = 15

/**
 * Default temperature (Celsius) at or below which the detector is considered to
 * be in a "freeze" condition. Used when the device does not expose its own
 * configured low-temperature limit.
 */
export const DEFAULT_FREEZE_THRESHOLD_C = 4
