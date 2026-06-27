# Roadmap

## Done (0.1.0 scaffold)

- Project scaffolding aligned to the `homebridge-myleviton` standard
  (strict TypeScript, ESLint flat config, Jest + coverage, PR CI matrix,
  release-please + OIDC publishing, Apache-2.0 + NOTICE).
- Honeywell Home API evaluation and typed contract (`docs/API.md`).
- OAuth2 `TokenManager` with proactive/single-flight refresh and rotation
  persistence (unit tested).
- `ResideoApiClient` with `apikey` + bearer injection, timeout, transient
  retry, and 401 refresh-and-retry (unit tested).
- Leak/temperature/humidity/battery/freeze HomeKit accessory mapping.
- Config schema and platform discovery + polling.

## Next

- [ ] **Account-linking UI** — a `homebridge-ui` custom server implementing the
      OAuth2 Authorization Code flow (no `curl` shell-out; use the API layer).
- [ ] **Integration tests** — `nock`-backed tests for `discoverDevices` and the
      poll loop; HAP-mocked tests for the accessory.
- [ ] **Live verification** — validate against real hardware and confirm the
      `waterLeakDetectors` path/fields on the current API.
- [ ] **Connectivity surfacing** — optionally reflect `isDeviceOffline` /
      `isAlive` as `StatusFault` / `StatusActive`.
- [ ] **Alarm mapping** — consider surfacing `currentAlarms` (e.g. high
      humidity) as faults.
