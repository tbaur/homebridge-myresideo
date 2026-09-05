# homebridge-myresideo

[![Tests](https://github.com/tbaur/homebridge-myresideo/actions/workflows/test.yml/badge.svg)](https://github.com/tbaur/homebridge-myresideo/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/homebridge-myresideo?style=flat-square)](https://www.npmjs.com/package/homebridge-myresideo)
[![npm downloads](https://img.shields.io/npm/dt/homebridge-myresideo?label=downloads&style=flat-square)](https://www.npmjs.com/package/homebridge-myresideo)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-green)](https://nodejs.org)
[![Homebridge](https://img.shields.io/badge/homebridge-%3E%3D2.0.0-purple)](https://homebridge.io)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

Monitor your **Resideo / Honeywell Home WiFi Water Leak & Freeze Detectors** in Apple HomeKit through Homebridge.

## Features

### Device Support
- **Automatic discovery** at startup, across every location on the account. Restart Homebridge to pick up a newly added detector
- **Leak Sensor** that follows the water-present state on each poll (default every 120s)
- **Temperature and humidity** as standard HomeKit sensors (each can be hidden). A missing reading is a fault, not a stale value
- **Battery** level and low-battery status
- **Offline and alarm faults** on the Leak Sensor (for example high humidity)
- **Optional freeze contact sensor** when temperature drops to or below a threshold

### Reliability
- **OAuth2 tokens refresh before they expire**, and are written back to `config.json` after every successful refresh
- **Retries** for transient network, timeout, 5xx, and 429 errors
- **Circuit breaker** during a sustained Resideo outage, so polling fails fast
- **Keeps cached detectors** if the cloud returns an empty or partial list
- **Diagnostics** *(optional):* periodic health lines in the Homebridge log

### Quality
- **Strict TypeScript** and a Jest suite with an 80% coverage gate
- **Secret hygiene:** credentials never reach the log
- **No analytics**

Every option, poll/check-in detail, and troubleshooting step is in [Detailed documentation](docs/README-DETAILED.md).

## Quick Start

### 1. Install

**Homebridge UI** (recommended): Plugins → Search `homebridge-myresideo` → Install

```bash
npm install -g homebridge-myresideo
```

### 2. Get API credentials

Create a developer application at [developer.honeywellhome.com](https://developer.honeywellhome.com) to obtain a **Consumer Key (API Key)** and **Consumer Secret (API Secret)**.

Then open this plugin's settings and use **Link your Resideo account**: enter the key and secret, click **Open Resideo sign-in**, approve access, and paste the **full redirect URL** from the address bar. Tokens are exchanged and saved for you.

The full walkthrough is in [docs/AUTH.md](docs/AUTH.md). The API is documented in [docs/API.md](docs/API.md).

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

Detectors appear in the Home app after startup discovery. Restart Homebridge after you add a detector to the Honeywell Home account.

## Supported Devices

| Type | Description |
|------|-------------|
| **WiFi Water Leak & Freeze Detector** | Resideo / Honeywell Home water leak detectors (`deviceClass: LeakDetector`), including temperature, humidity, and battery |

## Configuration Options

| Option | Required | Description |
|--------|:--------:|-------------|
| `name` | ✓ | Plugin instance name in the Homebridge log |
| `credentials.consumerKey` | ✓ | Resideo developer application API Key |
| `credentials.consumerSecret` | ✓ | Resideo developer application API Secret |
| `credentials.refreshToken` | ✓ | OAuth2 refresh token (set when linking) |
| `credentials.accessToken` | | OAuth2 access token (set when linking) |
| `options.refreshRate` | | Seconds between status polls (default 120, min 30, max 86400) |
| `options.freezeThresholdCelsius` | | Default freeze threshold in °C (−40 to 40). Unset uses the device's own limit |
| `options.diagnosticsInterval` | | Seconds between health-report log lines (default 10800). `0` disables |
| `options.structuredLogs` | | With diagnostics, also emit a JSON line (default false) |
| `options.devices[]` | | Per-device overrides, keyed by `deviceID` |

Per-device overrides and clamp rules are in the [detailed documentation](docs/README-DETAILED.md#full-configuration-reference).

## Not Working?

1. **Check credentials.** Consumer Key/Secret must match your Resideo developer app, and the account must be linked.
2. **Re-link if prompted.** A "refresh token invalid" log means you need to link again.
3. **Check the Honeywell Home app.** Detectors must be online there.
4. **Restart Homebridge** after any config change.

The [full troubleshooting list](docs/README-DETAILED.md#troubleshooting) covers empty discovery, stale removal, and how often a detector actually reports.

## Security

This plugin stores OAuth tokens (not your account password) in Homebridge's plaintext `config.json`. Anyone who can read files on the host can read those tokens. Redact `credentials` before posting logs or backups.

The plugin talks to Resideo over TLS only and redacts every credential from its logs. See [SECURITY.md](SECURITY.md).

## Requirements

- Homebridge 2.0+
- Node.js 22, 24, or 26
- A Resideo developer application and at least one registered water leak detector

## More Info

- [Detailed documentation](docs/README-DETAILED.md)
- [Account linking](docs/AUTH.md)
- [API notes](docs/API.md)
- [Features](docs/FEATURES.md)
- [Development](DEVELOPMENT.md)
- [Report Issues](https://github.com/tbaur/homebridge-myresideo/issues)
- [Changelog](CHANGELOG.md)

## License

Copyright 2026 tbaur

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) file for details.
