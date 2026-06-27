# Homebridge My Resideo

A [Homebridge](https://homebridge.io) plugin for **Resideo / Honeywell Home WiFi Water Leak & Freeze Detectors**.

This is an independent, ground-up reimplementation written directly against the
current [Resideo / Honeywell Home API](https://developer.honeywellhome.com)
(`api.honeywellhome.com`). It focuses on doing one device type well: the water
leak detector, including temperature, humidity, battery, and an optional
freeze-condition sensor.

> **Why this plugin exists:** Resideo deprecated the legacy `api.honeywell.com`
> domain (its certificate was retired), which broke older plugins with an
> endless "Failed to refresh access token" loop. This plugin targets the
> current domain and ships a resilient OAuth2 token manager.

## Features

- **Leak detection** — HomeKit Leak Sensor reflecting `waterPresent`.
- **Temperature & humidity** — exposed as standard HomeKit sensors (optional).
- **Battery** — level and low-battery status.
- **Freeze sensor (optional)** — a Contact Sensor that trips when the reported
  temperature is at or below a configurable threshold.
- **Resilient auth** — proactive token refresh, single-flight refresh, rotated
  refresh-token persistence, and clear messaging when re-linking is required.

## Requirements

- Node.js >= 20
- Homebridge v1.6+ or v2
- A Resideo developer application (API Key + Secret) from
  [developer.honeywellhome.com](https://developer.honeywellhome.com)

## Installation

```bash
npm install -g homebridge-myresideo
```

Or search for **My Resideo** in the Homebridge Config UI X plugin screen.

## Configuration

Configure via the Homebridge UI (recommended) or in `config.json`:

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

See [`docs/API.md`](docs/API.md) for the underlying Honeywell Home API contract
and [`docs/AUTH.md`](docs/AUTH.md) for the OAuth2 linking flow.

## Status

Early scaffold (`0.1.0`). The API client, OAuth2 token manager, types, config
schema, and HomeKit accessory mapping are in place. The account-linking UI and
live end-to-end verification against real hardware are the next milestones — see
[`docs/ROADMAP.md`](docs/ROADMAP.md).

## License

[Apache-2.0](LICENSE). Originally inspired by `homebridge-resideo`
(ISC, © 2023-2024 donavanbecker); see [`NOTICE`](NOTICE) for attribution.
