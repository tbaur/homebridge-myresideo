# homebridge-myresideo

[![Tests](https://github.com/tbaur/homebridge-myresideo/actions/workflows/test.yml/badge.svg)](https://github.com/tbaur/homebridge-myresideo/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/homebridge-myresideo?style=flat-square)](https://www.npmjs.com/package/homebridge-myresideo)
[![npm downloads](https://img.shields.io/npm/dt/homebridge-myresideo?label=downloads&style=flat-square)](https://www.npmjs.com/package/homebridge-myresideo)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-green)](https://nodejs.org)
[![Homebridge](https://img.shields.io/badge/homebridge-%3E%3D1.6.0-purple)](https://homebridge.io)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

Monitor your **Resideo / Honeywell Home WiFi Water Leak & Freeze Detectors** in Apple HomeKit through Homebridge.

## Features

### Device Support
- **Automatic Discovery** — Finds every water leak detector across all locations on your account, and removes detectors that disappear from your account
- **Leak Detection** — HomeKit Leak Sensor that reflects the water-present state on each polling cycle (default every 120s; see [polling](#configuration-options))
- **Temperature & Humidity** — Exposed as standard HomeKit sensors (each can be hidden); a missing reading is flagged as a fault rather than shown as a stale value
- **Battery** — Battery level plus low-battery status
- **Freeze Sensor** *(optional)* — A HomeKit contact sensor that trips when the temperature drops to or below a configurable threshold

### Reliability
- **Resilient OAuth2** — Access tokens are refreshed proactively, before they expire, so polling never stalls on an expired token
- **Refresh-Token Rotation** — Rotated refresh tokens are persisted automatically and survive restarts
- **Single-Flight Refresh** — Concurrent calls share one token refresh instead of stampeding the auth endpoint
- **Automatic Retry** — Transient network, timeout, and 5xx errors are retried with exponential backoff (for both API calls and token refresh)
- **Self-Healing Discovery** — A transient outage at startup is retried with capped backoff instead of leaving the plugin inert until a restart
- **Clear Re-Link Signaling** — An expired/invalid refresh token, or rejected API credentials, produce a clear, actionable log message instead of a silent failure loop
- **Secret Hygiene** — Credentials are never logged; the `apikey` is redacted from any logged URLs

### Quality
- **Strict TypeScript** — `noImplicitAny` and the full strict family enabled
- **Tested Core** — Jest suite with ≥80% coverage on the API/auth/util layers (currently ~96%)
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

> **Manual token step required.** A built-in account-linking UI is on the [roadmap](docs/ROADMAP.md) but not available yet. For now, obtain the initial OAuth2 `refreshToken` (and `accessToken`) with the included helper script and paste them into the config. From a clone of this repo, run `npm run build && npm run get-tokens -- --key <CONSUMER_KEY> --secret <CONSUMER_SECRET>`; it opens your browser, captures the redirect, and prints a ready-to-paste `credentials` block. The full walkthrough — including registering the redirect URI — is in [`docs/AUTH.md`](docs/AUTH.md); the underlying API is documented in [`docs/API.md`](docs/API.md).

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
        "refreshRate": 120,
        "freezeThresholdCelsius": 4
      }
    }
  ]
}
```

### 4. Restart Homebridge

Your detectors appear in the Home app automatically.

## Supported Devices

| Type | Description |
|------|-------------|
| **WiFi Water Leak & Freeze Detector** | Resideo / Honeywell Home water leak detectors (`deviceClass: LeakDetector`), including temperature, humidity, and battery reporting |

## Configuration Options

| Option | Required | Description |
|--------|:--------:|-------------|
| `name` | | Plugin instance name shown in the Homebridge log (defaults to `MyResideo`) |
| `credentials.consumerKey` | ✓ | Resideo developer application API Key |
| `credentials.consumerSecret` | ✓ | Resideo developer application API Secret |
| `credentials.refreshToken` | ✓ | OAuth2 refresh token (set when linking your account) |
| `credentials.accessToken` | | OAuth2 access token (set when linking your account) |
| `options.refreshRate` | | Seconds between status polls (default: 120, minimum: 30) |
| `options.freezeThresholdCelsius` | | Default freeze threshold in °C (default: 4) |
| `options.devices[]` | | Per-device overrides (see below) |

Per-device overrides (`options.devices[]`), keyed by `deviceID`:

| Option | Description |
|--------|-------------|
| `deviceID` | Honeywell device ID the override applies to |
| `name` | Display-name override for the accessory |
| `hideTemperatureSensor` | Hide the temperature sensor service |
| `hideHumiditySensor` | Hide the humidity sensor service |
| `enableFreezeSensor` | Expose a freeze contact sensor for this device |
| `freezeThresholdCelsius` | Freeze threshold override in °C for this device |

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

- [Features](docs/FEATURES.md)
- [API Reference](docs/API.md)
- [Authentication & Token Lifecycle](docs/AUTH.md)
- [Development](DEVELOPMENT.md)
- [Security Policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Releasing](RELEASING.md)
- [Roadmap](docs/ROADMAP.md)
- [Review (security/reliability/maintainability)](docs/REVIEW.md)
- [Report Issues](https://github.com/tbaur/homebridge-myresideo/issues)
- [Changelog](CHANGELOG.md)

## License

Copyright 2026 tbaur

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details and [`NOTICE`](NOTICE) for third-party attribution.
