# Changelog

All notable changes to this project are documented in this file. This file is maintained automatically by [release-please](https://github.com/googleapis/release-please) based on [Conventional Commits](https://www.conventionalcommits.org).

## [1.4.7](https://github.com/tbaur/homebridge-myresideo/compare/v1.4.6...v1.4.7) (2026-08-03)


### Bug Fixes

* align health diagnostics with sibling REST transport state ([#78](https://github.com/tbaur/homebridge-myresideo/issues/78)) ([a485226](https://github.com/tbaur/homebridge-myresideo/commit/a485226ce7cd2ee4ba3786fdb7df81d2a72e8e12))

## [1.4.6](https://github.com/tbaur/homebridge-myresideo/compare/v1.4.5...v1.4.6) (2026-08-01)


### Bug Fixes

* replace interval sliders with number fields ([#76](https://github.com/tbaur/homebridge-myresideo/issues/76)) ([46a39d1](https://github.com/tbaur/homebridge-myresideo/commit/46a39d1628c7ea1b0d5ba70e4b8910a0aa7af85d))

## [1.4.5](https://github.com/tbaur/homebridge-myresideo/compare/v1.4.4...v1.4.5) (2026-07-29)


### Bug Fixes

* harden detector polling and quiet diagnostics logs ([#73](https://github.com/tbaur/homebridge-myresideo/issues/73)) ([c109b91](https://github.com/tbaur/homebridge-myresideo/commit/c109b912f9de47db80083db7443a4da081f38f8b))

## [1.4.4](https://github.com/tbaur/homebridge-myresideo/compare/v1.4.3...v1.4.4) (2026-07-26)


### Bug Fixes

* block stale detector removal while the platform is unstable ([#70](https://github.com/tbaur/homebridge-myresideo/issues/70)) ([40c5fcf](https://github.com/tbaur/homebridge-myresideo/commit/40c5fcf26f826be5eb047ee17d36773f08b34279))

## [1.4.3](https://github.com/tbaur/homebridge-myresideo/compare/v1.4.2...v1.4.3) (2026-07-26)


### Bug Fixes

* harden discovery prune, quiet empty retries, degrade diagnostics ([#68](https://github.com/tbaur/homebridge-myresideo/issues/68)) ([0eb2438](https://github.com/tbaur/homebridge-myresideo/commit/0eb2438b7eb11964f81ef6a508d4b573141f8425))

## [1.4.2](https://github.com/tbaur/homebridge-myresideo/compare/v1.4.1...v1.4.2) (2026-07-26)


### Bug Fixes

* keep retrying discovery after an empty device list ([#66](https://github.com/tbaur/homebridge-myresideo/issues/66)) ([f72eee4](https://github.com/tbaur/homebridge-myresideo/commit/f72eee4fb01cbacce3e54ff8bc93688f20790c61))

## [1.4.1](https://github.com/tbaur/homebridge-myresideo/compare/v1.4.0...v1.4.1) (2026-07-26)


### Bug Fixes

* keep cached detectors when discovery returns empty ([#64](https://github.com/tbaur/homebridge-myresideo/issues/64)) ([d132178](https://github.com/tbaur/homebridge-myresideo/commit/d13217893bc576802cd2bca2edb43d1950c44e5c))

## [1.4.0](https://github.com/tbaur/homebridge-myresideo/compare/v1.3.0...v1.4.0) (2026-07-26)


### Features

* add circuit breaker, OAuth state, and resilient API outage handling ([#61](https://github.com/tbaur/homebridge-myresideo/issues/61)) ([ffd97f9](https://github.com/tbaur/homebridge-myresideo/commit/ffd97f9834cede99977d03309e5871021a514167))


### Bug Fixes

* keep OAuth state on the UI server, not sessionStorage ([#63](https://github.com/tbaur/homebridge-myresideo/issues/63)) ([d843621](https://github.com/tbaur/homebridge-myresideo/commit/d843621e2a71601676aa6a544226b110779a13b2))

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
