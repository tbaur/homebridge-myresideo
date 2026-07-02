# Changelog

All notable changes to this project are documented in this file. This file is maintained automatically by [release-please](https://github.com/googleapis/release-please) based on [Conventional Commits](https://www.conventionalcommits.org).

## [1.3.0](https://github.com/tbaur/homebridge-myresideo/compare/v1.2.0...v1.3.0) (2026-07-02)


### Features

* per-check-in device reporting and leaner health diagnostics ([#44](https://github.com/tbaur/homebridge-myresideo/issues/44)) ([7d04e51](https://github.com/tbaur/homebridge-myresideo/commit/7d04e5120623abe70b35df65bf638510f413622a))

## [1.2.0](https://github.com/tbaur/homebridge-myresideo/compare/v1.1.0...v1.2.0) (2026-06-29)


### Features

* log per-detector state summary at startup ([#42](https://github.com/tbaur/homebridge-myresideo/issues/42)) ([86a2559](https://github.com/tbaur/homebridge-myresideo/commit/86a255915da85bcb094617bc92523668064d373d))

## [1.1.0](https://github.com/tbaur/homebridge-myresideo/compare/v1.0.1...v1.1.0) (2026-06-29)


### Features

* add opt-in health diagnostics reporting ([#40](https://github.com/tbaur/homebridge-myresideo/issues/40)) ([45c469d](https://github.com/tbaur/homebridge-myresideo/commit/45c469d6b76e8ec205532c0f8a042d18985335b1))

## [1.0.1](https://github.com/tbaur/homebridge-myresideo/compare/v1.0.0...v1.0.1) (2026-06-29)


### Bug Fixes

* remove orphaned optional sensor services from cached accessories ([#38](https://github.com/tbaur/homebridge-myresideo/issues/38)) ([3ca62e3](https://github.com/tbaur/homebridge-myresideo/commit/3ca62e3dea3d62587c384c34f284b689eab7d4cf))

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
