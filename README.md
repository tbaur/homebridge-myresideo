# homebridge-myresideo

[![Tests](https://github.com/tbaur/homebridge-myresideo/actions/workflows/test.yml/badge.svg)](https://github.com/tbaur/homebridge-myresideo/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/homebridge-myresideo?style=flat-square)](https://www.npmjs.com/package/homebridge-myresideo)
[![npm downloads](https://img.shields.io/npm/dt/homebridge-myresideo?label=downloads&style=flat-square)](https://www.npmjs.com/package/homebridge-myresideo)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-green)](https://nodejs.org)
[![Homebridge](https://img.shields.io/badge/homebridge-%3E%3D1.6.0%20%7C%7C%202.x-purple)](https://homebridge.io)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

Monitor your **Resideo / Honeywell Home WiFi Water Leak & Freeze Detectors** in Apple HomeKit through Homebridge.

## Features

### Device Support
- **Automatic Discovery** — At startup, finds every water leak detector across all locations on your account, and removes detectors that disappear from your account (restart Homebridge to pick up newly-added detectors)
- **Leak Detection** — HomeKit Leak Sensor that reflects the water-present state on each polling cycle (default every 120s; see [polling](#configuration-options))
- **Temperature & Humidity** — Exposed as standard HomeKit sensors (each can be hidden); a missing reading is flagged as a fault rather than shown as a stale value
- **Battery** — Battery level plus low-battery status
- **Connectivity & Alarms** — An offline detector or any active device alarm (e.g. high humidity) is surfaced as a HomeKit fault on the Leak Sensor, and the alarm type is logged when it changes
- **Freeze Sensor** *(optional)* — A HomeKit contact sensor that trips when the temperature drops to or below a configurable threshold

### Reliability
- **Resilient OAuth2** — Access tokens are refreshed proactively, before they expire, so polling never stalls on an expired token
- **Refresh-Token Rotation** — Rotated refresh tokens are persisted automatically and survive restarts
- **Single-Flight Refresh** — Concurrent calls share one token refresh instead of stampeding the auth endpoint
- **Automatic Retry** — Transient network, timeout, and 5xx errors are retried with exponential backoff (for both API calls and token refresh)
- **Self-Healing Discovery** — A transient outage at startup is retried with capped backoff instead of leaving the plugin inert until a restart
- **Clear Re-Link Signaling** — An expired/invalid refresh token, or rejected API credentials, produce a clear, actionable log message instead of a silent failure loop
- **Readable Logs** — Each poll logs only what changed (leak, online/offline, low battery, freeze, alarms) once per transition, so the log reflects events without per-cycle noise; a full snapshot is available at debug level
- **Secret Hygiene** — Credentials are never logged; the `apikey` is redacted from any logged URLs

### Quality
- **Strict TypeScript** — `strict` mode (`noImplicitAny`, `strictNullChecks`, no unused locals/params, no implicit returns, and more)
- **Tested Core** — Jest suite with a ≥80% coverage gate across statements, branches, functions, and lines
- **CI on Every PR** — Build, lint, and test across Node 20/22/24, plus a dependency audit
- **No Analytics** — Zero tracking or data collection

## Quick Start

### 1. Install

**Homebridge UI** (recommended): Plugins → Search `homebridge-myresideo` → Install

**Command line:**
```bash
npm install -g homebridge-myresideo
```

### 2. Get API credentials

Create a developer application at [developer.honeywellhome.com](https://developer.honeywellhome.com) to obtain a **Consumer Key (API Key)** and **Consumer Secret (API Secret)**.

> **Link your account in the plugin settings.** After installing, open this plugin's settings in the Homebridge UI and use the **Link your Resideo account** panel: enter your Consumer Key and Secret, click **Open Resideo sign-in**, approve access, then paste the redirected URL (or just the `code` it contains) back to finish — the access/refresh tokens are exchanged and saved for you. The `code` travels in the redirect URL itself, so this works the same whether Homebridge runs locally or on a remote host. Prefer the command line? The included `get-tokens` helper runs the same flow from a clone of this repo (`npm install && npm run get-tokens`). The full walkthrough — registering the redirect URL, the paste step, and the script fallback — is in [`docs/AUTH.md`](docs/AUTH.md); the underlying API is documented in [`docs/API.md`](docs/API.md).

### 3. Configure

Use the Homebridge UI (recommended) or add the platform to your config:

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
        "refreshRate": 120
      }
    }
  ]
}
```

### 4. Restart Homebridge

Your detectors are discovered at startup and appear in the Home app automatically. If you add a new detector to your Honeywell Home account later, restart Homebridge to pick it up.

## Supported Devices

| Type | Description |
|------|-------------|
| **WiFi Water Leak & Freeze Detector** | Resideo / Honeywell Home water leak detectors (`deviceClass: LeakDetector`), including temperature, humidity, and battery reporting |

## Configuration Options

| Option | Required | Description |
|--------|:--------:|-------------|
| `name` | ✓ | Plugin instance name shown in the Homebridge log (required by the schema; pre-filled with `MyResideo`) |
| `credentials.consumerKey` | ✓ | Resideo developer application API Key |
| `credentials.consumerSecret` | ✓ | Resideo developer application API Secret |
| `credentials.refreshToken` | ✓ | OAuth2 refresh token (set when linking your account) |
| `credentials.accessToken` | | OAuth2 access token (set when linking your account) |
| `options.refreshRate` | | Seconds between status polls (default: 120, minimum: 30) |
| `options.freezeThresholdCelsius` | | Default freeze threshold in °C. Leave unset to use each device's own configured low-temperature limit (falling back to 4 °C if the device reports none). A per-device override takes precedence. |
| `options.devices[]` | | Per-device overrides (see below) |

Per-device overrides (`options.devices[]`), keyed by `deviceID`:

| Option | Required | Description |
|--------|:--------:|-------------|
| `deviceID` | ✓ | Honeywell device ID the override applies to (entries without it are ignored) |
| `name` | | Display-name override for the accessory |
| `hideTemperatureSensor` | | Hide the temperature sensor service |
| `hideHumiditySensor` | | Hide the humidity sensor service |
| `enableFreezeSensor` | | Expose a freeze contact sensor for this device |
| `freezeThresholdCelsius` | | Freeze threshold override in °C for this device |

## Not Working?

1. **Check credentials** — Consumer Key/Secret must match your Resideo developer app, and the account must be linked
2. **Re-link if prompted** — A "refresh token invalid" log message means you need to re-link your account
3. **Check device status** — Detectors must be online in the Honeywell Home app
4. **Restart Homebridge** — Required after any config change

## Security

This plugin uses Resideo's OAuth2 flow, so it stores OAuth tokens (not your account password) in Homebridge's `config.json`. Because Homebridge keeps plugin config in plain text, those tokens live unencrypted on the Homebridge host.

- **Secure the Homebridge host.** Anyone who can read files on it can read your tokens.
- **Scrub before sharing.** Redact `credentials` from `config.json` before posting logs or backups.

The plugin talks to Resideo over TLS only, redacts tokens and the `apikey` from its logs, and never collects analytics. See [`SECURITY.md`](SECURITY.md).

## Requirements

- Homebridge 1.6.0+ or 2.0+
- Node.js 20+
- A Resideo developer application and at least one registered water leak detector

## More Info

- [Report Issues](https://github.com/tbaur/homebridge-myresideo/issues)
- [Changelog](CHANGELOG.md)

## License

Copyright 2026 tbaur

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details and [`NOTICE`](NOTICE) for third-party attribution.
