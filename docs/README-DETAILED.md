# homebridge-myresideo detailed documentation

Install and a short options table live in the [README](../README.md). This page is the rest: every option, how polling relates to a detector's own check-in, and how HomeKit is protected during a Resideo outage.

## Table of Contents

- [Full configuration reference](#full-configuration-reference)
- [How devices appear](#how-devices-appear)
- [Polling and check-in](#polling-and-check-in)
- [Discovery and stale removal](#discovery-and-stale-removal)
- [Diagnostics](#diagnostics)
- [Troubleshooting](#troubleshooting)
- [Related docs](#related-docs)

## Full configuration reference

```json
{
  "platforms": [
    {
      "platform": "MyResideo",
      "name": "MyResideo",
      "credentials": {
        "consumerKey": "your-api-key",
        "consumerSecret": "your-api-secret",
        "accessToken": "obtained-when-linking",
        "refreshToken": "obtained-when-linking"
      },
      "options": {
        "refreshRate": 120,
        "freezeThresholdCelsius": 4,
        "diagnosticsInterval": 10800,
        "structuredLogs": false,
        "devices": [
          {
            "deviceID": "L123456",
            "name": "Utility room",
            "hideTemperatureSensor": false,
            "hideHumiditySensor": false,
            "enableFreezeSensor": true,
            "freezeThresholdCelsius": 2
          }
        ]
      }
    }
  ]
}
```

`name` is required by the schema and is pre-filled with `MyResideo`.

| Option | Required | Description |
|--------|:--------:|-------------|
| `name` | ✓ | Plugin instance name in the Homebridge log |
| `credentials.consumerKey` | ✓ | Resideo developer application API Key |
| `credentials.consumerSecret` | ✓ | Resideo developer application API Secret |
| `credentials.refreshToken` | ✓ | OAuth2 refresh token (set when linking your account) |
| `credentials.accessToken` | | OAuth2 access token (set when linking your account) |
| `options.refreshRate` | | Seconds between status polls. Default 120, minimum 30, maximum 86400. Out-of-range values are clamped. A non-numeric value falls back to the default. |
| `options.freezeThresholdCelsius` | | Default freeze threshold in °C, between −40 and 40 (values outside that range are ignored). Leave unset to use each device's own configured low-temperature limit (falling back to 4 °C if the device reports none). A per-device override takes precedence. |
| `options.diagnosticsInterval` | | Seconds between health-report log lines. Default 10800 (3 hours). `0` disables. Values 1–29 are clamped up to 30. Maximum is 86400 (24h). |
| `options.structuredLogs` | | When diagnostics are enabled, also emit a machine-readable JSON line next to the human summary. Default false. |
| `options.devices[]` | | Per-device overrides (see below) |

Per-device overrides (`options.devices[]`), keyed by `deviceID`:

| Option | Required | Description |
|--------|:--------:|-------------|
| `deviceID` | ✓ | Honeywell device ID the override applies to (entries without it are ignored) |
| `name` | | Display-name override for the accessory |
| `hideTemperatureSensor` | | Hide the temperature sensor service |
| `hideHumiditySensor` | | Hide the humidity sensor service |
| `enableFreezeSensor` | | Expose a freeze contact sensor for this device |
| `freezeThresholdCelsius` | | Freeze threshold override in °C for this device, between −40 and 40 (values outside that range are ignored) |

Linking the account (UI panel or `npm run get-tokens`) is documented in [AUTH.md](AUTH.md).

## How devices appear

| Type | Honeywell `deviceClass` | HomeKit services |
|------|-------------------------|------------------|
| WiFi Water Leak & Freeze Detector | `LeakDetector` | Leak Sensor, Battery; Temperature and Humidity unless hidden; Contact Sensor (freeze) when `enableFreezeSensor` is set |

A missing temperature, humidity, or battery reading raises a fault instead of showing a stale value. An offline detector or any active device alarm (for example high humidity) is a HomeKit fault on the Leak Sensor, and the alarm type is logged when it changes.

A freeze contact sensor trips when temperature is at or below the configured threshold.

## Polling and check-in

`refreshRate` is how often the plugin asks Resideo for the latest cloud snapshot. The physical detector uploads on its own schedule (the Resideo app's 1–3×/day update frequency). HomeKit freshness for leak and sensor data is still bounded by `lastCheckin`.

Each poll logs only what changed (leak, online/offline, low battery, freeze, alarms) once per transition. Routine poll misses stay at debug.

When `lastCheckin` advances, the plugin logs a one-line summary prefixed with that detector's name: current readings and poll latency.

## Discovery and stale removal

Discovery runs at startup and finds every water leak detector across all locations on the account.

A transient outage at startup is retried with capped backoff instead of leaving the plugin inert until a restart.

If Resideo returns an empty or partial device list during a cloud outage, the plugin keeps cached accessories and keeps retrying discovery. A detector is removed only after it is missing from several consecutive **non-empty** discoveries while the platform is stable (not degraded, breaker closed). A blip cannot wipe HomeKit.

Restart Homebridge to pick up a detector you just added to the Honeywell Home account.

Tokens refresh before they expire. After every successful refresh, the current refresh and access tokens are written back to `config.json`. Concurrent calls share one token refresh.

Sustained API failures open a circuit breaker so polling fails fast. OPEN is logged at warn; HALF_OPEN probes and CLOSED recovery at info.

## Diagnostics

`diagnosticsInterval` defaults to 10800 (3 hours). `0` disables it.

Each report includes device online count, REST transport state (`live` / `connecting` / `stopped` / `auth-failed`), and API latency (p50/p95 with request/error counts), with a `healthy`/`degraded` rollup.

An active leak and a non-CLOSED circuit breaker appear on the human line only when they carry signal. Token expiry and full counters stay in the optional structured JSON.

Healthy↔degraded transitions are logged as they happen. `structuredLogs` adds a JSON line next to the human summary.

The feature checklist in [FEATURES.md](FEATURES.md) lists every reliability behaviour. Architecture: [DEVELOPMENT.md](../DEVELOPMENT.md).

## Troubleshooting

1. **Check credentials.** Consumer Key/Secret must match your Resideo developer app, and the account must be linked.
2. **Re-link if prompted.** A "refresh token invalid" log message means you need to link the account again. See [AUTH.md](AUTH.md).
3. **Check the Honeywell Home app.** Detectors must be online there.
4. **HomeKit looks stale.** The plugin can poll more often than the detector uploads. Check `lastCheckin` in the per-check-in log line.
5. **A detector vanished after an outage.** It should not, unless several stable, non-empty discoveries omitted it. Check for circuit-breaker OPEN and empty-discovery retries.
6. **Restart Homebridge** after any config change, and after you add a detector to the account.

## Related docs

- [README](../README.md): install and short options table
- [AUTH.md](AUTH.md): linking the Resideo account
- [API.md](API.md): Honeywell Home API
- [FEATURES.md](FEATURES.md): full feature checklist
- [DEVELOPMENT.md](../DEVELOPMENT.md)
- [SECURITY.md](../SECURITY.md)

## License

Copyright 2026 tbaur

Licensed under the Apache License, Version 2.0. See [LICENSE](../LICENSE) file for details.
