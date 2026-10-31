# homebridge-myresideo detailed documentation

Install and a short options table live in the [README](../README.md). This page is the rest: every option, how polling relates to a detector's own check-in, and how HomeKit is protected during a Resideo outage.

## Table of Contents

- [Full configuration reference](#full-configuration-reference)
- [How devices appear](#how-devices-appear)
- [Polling and check-in](#polling-and-check-in)
- [Discovery and stale removal](#discovery-and-stale-removal)
- [Diagnostics](#diagnostics)
- [PagerDuty](#pagerduty)
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
        "diagnosticsInterval": 0,
        "structuredLogs": false,
        "pagerdutySignals": false,
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
| `options.offlineHoldMinutes` | | Minutes a detector must stay unreachable before HomeKit and PagerDuty show it offline. Default 10. Allowed range 0–60; out-of-range values are clamped. 0 turns the hold off. See [Offline hold](#offline-hold). |
| `options.diagnosticsInterval` | | Seconds between health-report log lines. Default 0 (off). Values 1–29 are clamped up to 30. Maximum is 86400 (24h). |
| `options.structuredLogs` | | When diagnostics are enabled, also emit a machine-readable JSON line next to the human summary. Default false. |
| `options.pagerdutySignals` | | Write this plugin's alert conditions to homebridge-pagerduty. Off until turned on. See [PagerDuty](#pagerduty). Needs Node 22.13 or later. |
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

### Offline hold

During a Resideo cloud incident, the API can answer normally but report detectors as unreachable with a battery of 0%, and drop their readings and alarms. The detectors are fine, and the next poll or two returns the real record. `offlineHoldMinutes` (default 10) sets how long an unreachable report must last before the plugin believes it.

During the hold, HomeKit keeps the detector's last trusted state: online, battery, temperature, humidity and alarms. Leak state is never held, so a leak still shows and pages at once. The log does not report the detector offline, and PagerDuty does not page.

If the report lasts past the hold, the detector shows offline with no battery reading, because the 0% in that record is not a real reading. The hold also works across a restart: the plugin holds against the state it last saved in the Homebridge accessory cache.

## Discovery and stale removal

Discovery runs at startup and finds every water leak detector across all locations on the account.

A transient outage at startup is retried with capped backoff instead of leaving the plugin inert until a restart.

If Resideo returns an empty or partial device list during a cloud outage, the plugin keeps cached accessories and keeps retrying discovery. A detector is removed only after it is missing from several consecutive **non-empty** discoveries while the platform is stable (not degraded, breaker closed). A blip cannot wipe HomeKit.

Restart Homebridge to pick up a detector you just added to the Honeywell Home account.

Tokens refresh before they expire. After every successful refresh, the current refresh and access tokens are written to a plugin-owned file under Homebridge storage. Concurrent calls share one token refresh. Runtime refresh does not rewrite `config.json`.

Sustained API failures open a circuit breaker so polling fails fast. OPEN is logged at warn; HALF_OPEN probes and CLOSED recovery at info.

## Diagnostics

`diagnosticsInterval` defaults to 0 (off). Set it to a number of seconds to emit a periodic health report. Values 1–29 are clamped up to 30.

Each report includes device online count, REST transport state (`live` / `connecting` / `stopped` / `auth-failed`), and API latency (p50/p95 with request/error counts), with a `healthy`/`degraded` rollup.

An active leak and a non-CLOSED circuit breaker appear on the human line only when they carry signal. Token expiry and full counters stay in the optional structured JSON.

Healthy↔degraded transitions are logged as they happen. `structuredLogs` adds a JSON line next to the human summary.

The feature checklist in [FEATURES.md](FEATURES.md) lists every reliability behaviour. Architecture: [DEVELOPMENT.md](../DEVELOPMENT.md).

The diagnostics REST state `auth-failed` is a token-refresh cooldown. It is a separate flag from the PagerDuty signal of the same name.

## PagerDuty

This plugin can page through [homebridge-pagerduty](https://github.com/tbaur/homebridge-pagerduty) when something needs attention. It needs Node 22.13 or later. The setting is off until you turn it on.

1. Turn on **Send Signals to PagerDuty** (`options.pagerdutySignals`) in this plugin's settings, under **General**.
2. Restart Homebridge.
3. In homebridge-pagerduty's settings, allow homebridge-myresideo to page, save, and restart Homebridge again. [Signals from other plugins](https://github.com/tbaur/homebridge-pagerduty/blob/main/docs/SIGNALS.md#let-a-plugin-page) explains each step and what else you can set for each signal.

Each condition below then opens a PagerDuty alert while it is present, and resolves it when it clears. The page does not name the detector.

| Signal | Severity | Active when |
| --- | --- | --- |
| `leak` | critical | A water leak detector this plugin publishes is wet |
| `detector-offline` | error | A water leak detector this plugin publishes is offline |
| `low-battery` | warning | A water leak detector this plugin publishes reports a battery at or below 15% |
| `auth-failed` | error | Sign-in has stopped and will not be retried |
| `cloud-offline` | error | No detector body for 5 minutes, or Resideo reports every detector offline |

How the signals behave:

- `leak` follows `waterPresent` on a detector body Resideo just returned. The summary is "A water leak detector is wet."
- `detector-offline` follows a body that says the detector is not alive, is offline, or has not checked in, once that report has lasted past the [offline hold](#offline-hold). A thrown request is not offline. Omitted reachability fields are online. If two or more detectors are published and every one of them is offline, that is treated as a Resideo problem: `cloud-offline` pages instead, and `detector-offline` stays clear. The summary is "A water leak detector is offline."
- `low-battery` follows a reported battery at or below 15%. A missing battery stays clear. The battery on an unreachable record is not a reading, so it stays clear too. The summary is "A water leak detector battery is low."
- `leak` and `low-battery` page as soon as one body says so. `detector-offline` and the all-offline case of `cloud-offline` are decided at the end of each poll. It clears only when every detector still in HomeKit was part of that read and none of them still have it. A detector omitted from the list, including one waiting out stale-removal, blocks the clear.
- An empty device list does not clear those three signals and does not count as reaching Resideo. A detector restored from the Homebridge cache does not page until a new body arrives.
- `auth-failed` turns on when Resideo rejects the account link, refuses this developer app (HTTP 403), or rejects the Consumer Key or Secret. Each case uses its own sentence. A 404, a 429, a network timeout, an open circuit breaker, and a 401 that the client is about to refresh do not turn this on. The diagnostics cooldown of the same name does not turn this on. A locations list does not clear it while the device poll that follows is still running. That poll clears it only when the poll itself does not see a stopped sign-in.
- `cloud-offline` turns on only after 5 minutes with no detector body, counted from launch and again from the start of a later outage. Later failures do not extend a timer that is already running. It stays off while `auth-failed` is on. If the signal file cannot take the write when the five minutes elapse, the plugin tries again while the outage continues. The summary is "Homebridge has not reached Resideo for 5 minutes. Leak detector state in HomeKit may be stale." When Resideo answers but reports every detector offline past the hold, the summary is "Resideo reports every water leak detector offline. This is most likely a Resideo cloud problem."
- At startup the plugin logs one line, `homebridge-pagerduty support is enabled (leak, detector-offline, low-battery, auth-failed, cloud-offline)`, before the first request. The line is logged once, and it is not logged when the setting is off or when startup validation failed.
- Shutdown closes the store and does not clear a signal.
- The store needs `node:sqlite`, which Node provides from 22.13. On an older Node the plugin logs one warning and keeps running without signals. Nothing is written until the setting is on.

Summaries are fixed sentences. They do not include a detector name, an account, or an address.

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
