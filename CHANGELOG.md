# Changelog

All notable changes to this project are documented in this file. This file is maintained automatically by [release-please](https://github.com/googleapis/release-please) based on [Conventional Commits](https://www.conventionalcommits.org).

## 1.0.0 (2026-06-29)

Initial stable release. Monitors Resideo / Honeywell Home WiFi Water Leak & Freeze Detectors in Apple HomeKit through Homebridge.

### Features

* Automatic discovery of water leak detectors across all account locations, with removal of detectors that leave the account
* HomeKit leak detection, temperature and humidity sensors (each hideable), and battery level / low-battery status
* Optional freeze contact sensor that trips at or below a configurable temperature threshold
* Offline detectors and active device alarms surfaced as HomeKit faults on the leak sensor
* Guided OAuth2 account linking from the Homebridge UI, with proactive token refresh, refresh-token rotation, and single-flight refresh
* Resilient networking with exponential-backoff retry for transient failures and self-healing startup discovery
* Per-device configuration overrides validated at startup, with secret-safe logging
