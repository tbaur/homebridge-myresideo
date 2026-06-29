/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Plugin-wide constants and Resideo / Honeywell Home API endpoints.
 */
/** Name used to register the plugin with Homebridge (must match package.json name). */
export declare const PLUGIN_NAME = "homebridge-myresideo";
/** Platform identifier referenced in the user's Homebridge config. */
export declare const PLATFORM_NAME = "MyResideo";
/** Prefix used when generating stable HAP accessory UUIDs. */
export declare const UUID_PREFIX = "myresideo-";
/**
 * Base host for the Resideo / Honeywell Home API.
 *
 * All requests must target `api.honeywellhome.com`; the older `api.honeywell.com`
 * host is deprecated and must not be used.
 *
 * @see https://developer.honeywellhome.com
 */
export declare const API_BASE_URL = "https://api.honeywellhome.com";
/** OAuth2 authorize endpoint (browser redirect target). */
export declare const AUTHORIZE_URL = "https://api.honeywellhome.com/oauth2/authorize";
/** OAuth2 token endpoint (authorization_code exchange and refresh_token). */
export declare const TOKEN_URL = "https://api.honeywellhome.com/oauth2/token";
/** Returns all locations (and their devices) for the authenticated user. */
export declare const LOCATIONS_URL = "https://api.honeywellhome.com/v2/locations";
/** Base path for device resources. Append `/{deviceType}` and `/{deviceId}`. */
export declare const DEVICES_URL = "https://api.honeywellhome.com/v2/devices";
/** Device-type path segment for WiFi Water Leak & Freeze Detectors. */
export declare const WATER_LEAK_DETECTOR_TYPE = "waterLeakDetectors";
/** Honeywell `deviceClass` value identifying a water leak detector. */
export declare const LEAK_DETECTOR_DEVICE_CLASS = "LeakDetector";
/** Default polling interval (seconds) for refreshing device status. */
export declare const DEFAULT_REFRESH_RATE_SEC = 120;
/** Minimum allowed polling interval (seconds) to avoid hammering the API. */
export declare const MIN_REFRESH_RATE_SEC = 30;
/** Default request timeout (ms) for API calls (including token refresh). */
export declare const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
/** Maximum number of token-refresh attempts before surfacing the failure. */
export declare const MAX_TOKEN_REFRESH_ATTEMPTS = 3;
/** Maximum number of attempts for a single API request before surfacing the failure. */
export declare const MAX_API_RETRY_ATTEMPTS = 3;
/** Upper bound on how long a server-supplied `Retry-After` can pause a retry. */
export declare const MAX_RETRY_AFTER_MS = 60000;
/**
 * Cap on how many bytes a single API or token response body may buffer. Real
 * Resideo payloads are a few KB; this guards against a buggy/hostile endpoint
 * streaming an unbounded body into memory and exhausting the process.
 */
export declare const MAX_RESPONSE_BODY_BYTES: number;
/**
 * Number of devices polled concurrently each cycle. Keeps API fan-out bounded
 * while still parallelizing so cycle time does not grow linearly with devices.
 */
export declare const POLL_DEVICE_CONCURRENCY = 4;
/**
 * Self-healing discovery: if initial device discovery fails (transient cloud or
 * network outage at boot), retry with capped exponential backoff instead of
 * leaving the plugin permanently inert until a manual Homebridge restart.
 */
export declare const INITIAL_DISCOVERY_RETRY_MS = 15000;
/** Upper bound on the self-healing discovery backoff. */
export declare const MAX_DISCOVERY_RETRY_MS: number;
/**
 * Refresh the access token this many milliseconds before it actually expires,
 * so an in-flight poll never races a token expiry.
 */
export declare const TOKEN_REFRESH_BUFFER_MS = 60000;
/** Fallback access-token lifetime (seconds) when the API omits `expires_in`. */
export declare const DEFAULT_TOKEN_TTL_SEC = 1799;
/**
 * Floor on the usable lifetime of an access token after subtracting the refresh
 * buffer. Guards against a pathologically short `expires_in` (≤ the buffer)
 * causing every {@link getAccessToken} call to treat a brand-new token as
 * already expired and stampede the auth endpoint.
 */
export declare const MIN_TOKEN_LIFETIME_MS = 30000;
/** Battery percentage at or below which HomeKit reports "low battery". */
export declare const LOW_BATTERY_THRESHOLD = 15;
/**
 * Minimum allowed diagnostics interval (seconds). Below this the health report
 * would spam the log without adding signal; a sub-minimum value is clamped up.
 */
export declare const MIN_DIAGNOSTICS_INTERVAL_SEC = 30;
/**
 * How long after a failed token refresh the plugin keeps reporting degraded
 * health, so a transient refresh blip is visible in diagnostics for a sensible
 * window rather than only on the exact heartbeat that coincided with it.
 */
export declare const TOKEN_REFRESH_FAILURE_COOLDOWN_MS: number;
/**
 * Default temperature (Celsius) at or below which the detector is considered to
 * be in a "freeze" condition. Used when the device does not expose its own
 * configured low-temperature limit.
 */
export declare const DEFAULT_FREEZE_THRESHOLD_C = 4;
//# sourceMappingURL=settings.d.ts.map