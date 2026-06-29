# Changelog

All notable changes to this project are documented in this file. This file is maintained automatically by [release-please](https://github.com/googleapis/release-please) based on [Conventional Commits](https://www.conventionalcommits.org).

## [1.0.0](https://github.com/tbaur/homebridge-myresideo/compare/v0.1.12...v1.0.0) (2026-06-29)


### Miscellaneous Chores

* graduate to 1.0.0 ([#34](https://github.com/tbaur/homebridge-myresideo/issues/34)) ([6c003a6](https://github.com/tbaur/homebridge-myresideo/commit/6c003a667b5bad466482ab5918874eb50d16081d))

## [0.1.12](https://github.com/tbaur/homebridge-myresideo/compare/v0.1.11...v0.1.12) (2026-06-29)


### Bug Fixes

* release transport sockets promptly and bump nock to 14 ([#32](https://github.com/tbaur/homebridge-myresideo/issues/32)) ([200b948](https://github.com/tbaur/homebridge-myresideo/commit/200b948676148502e347b453e253379eb93c621d))

## [0.1.11](https://github.com/tbaur/homebridge-myresideo/compare/v0.1.10...v0.1.11) (2026-06-29)


### Bug Fixes

* stop config-ui-x fabricating an invalid per-device override ([#29](https://github.com/tbaur/homebridge-myresideo/issues/29)) ([6363676](https://github.com/tbaur/homebridge-myresideo/commit/63636760e57d6f7360af3ef646368970532d1c24))

## [0.1.10](https://github.com/tbaur/homebridge-myresideo/compare/v0.1.9...v0.1.10) (2026-06-29)


### Bug Fixes

* make config schema valid so config-ui-x validation passes ([#27](https://github.com/tbaur/homebridge-myresideo/issues/27)) ([29d731a](https://github.com/tbaur/homebridge-myresideo/commit/29d731a2846a8646bd4f2fb14672635378259b59))

## [0.1.9](https://github.com/tbaur/homebridge-myresideo/compare/v0.1.8...v0.1.9) (2026-06-29)


### Bug Fixes

* persist account credentials by declaring them in config schema ([d03e5b9](https://github.com/tbaur/homebridge-myresideo/commit/d03e5b9a661e29c2ccf7814bd6e75c6402ee07e6))

## [0.1.8](https://github.com/tbaur/homebridge-myresideo/compare/v0.1.7...v0.1.8) (2026-06-29)


### Bug Fixes

* wait for config-ui-x 'ready' before requesting the server child ([7520c80](https://github.com/tbaur/homebridge-myresideo/commit/7520c80d2071a54a6df225dcbf5498cd06ddd2a2))

## [0.1.7](https://github.com/tbaur/homebridge-myresideo/compare/v0.1.6...v0.1.7) (2026-06-29)


### Bug Fixes

* gate token exchange on a warmed UI server and bound every call ([a094a5c](https://github.com/tbaur/homebridge-myresideo/commit/a094a5c9855f1ef638abe529b0c0ffb07b396412))

## [0.1.6](https://github.com/tbaur/homebridge-myresideo/compare/v0.1.5...v0.1.6) (2026-06-29)


### Bug Fixes

* warm up UI server child so token-exchange spinner never hangs ([7dd0f43](https://github.com/tbaur/homebridge-myresideo/commit/7dd0f43bc67f7713213ce974565f142c3801deb0))

## [0.1.5](https://github.com/tbaur/homebridge-myresideo/compare/v0.1.4...v0.1.5) (2026-06-29)


### Bug Fixes

* harden discovery retry, config validation, and token persistence ([#10](https://github.com/tbaur/homebridge-myresideo/issues/10)) ([69758d5](https://github.com/tbaur/homebridge-myresideo/commit/69758d5e290f9e0ea76f23d02531d88bc1f1332d))

## [0.1.4](https://github.com/tbaur/homebridge-myresideo/compare/v0.1.3...v0.1.4) (2026-06-29)


### Bug Fixes

* build authorize URL client-side so first-install sign-in never hangs ([438c08c](https://github.com/tbaur/homebridge-myresideo/commit/438c08cecde543cd3a8d6caf4d5128cac0167f5e))

## [0.1.3](https://github.com/tbaur/homebridge-myresideo/compare/v0.1.2...v0.1.3) (2026-06-29)


### Bug Fixes

* collapsible settings layout + linked-state UI ([7dd4b75](https://github.com/tbaur/homebridge-myresideo/commit/7dd4b752727110362a1a003a45fc22fc4145b201))

## [0.1.2](https://github.com/tbaur/homebridge-myresideo/compare/v0.1.1...v0.1.2) (2026-06-29)


### Bug Fixes

* polish account-linking UI and tidy docs ([5afb069](https://github.com/tbaur/homebridge-myresideo/commit/5afb0698a8e310fc8ea83c694ff5927dd2702a30))

## [0.1.1](https://github.com/tbaur/homebridge-myresideo/compare/v0.1.0...v0.1.1) (2026-06-29)


### Bug Fixes

* refine account-linking UI and settings form ([c42ff17](https://github.com/tbaur/homebridge-myresideo/commit/c42ff17e63b6406b038b73d7e2c3000645deee6d))

## 0.1.0

- Initial scaffold: project tooling, typed Honeywell Home API contract, OAuth2 token manager, API client, and HomeKit accessory mapping for WiFi Water Leak & Freeze Detectors.
