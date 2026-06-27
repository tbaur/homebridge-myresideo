# Roadmap

## Done (0.1.0 scaffold)

- Project foundation: strict TypeScript, ESLint flat config, Jest + coverage, PR CI matrix, release-please + OIDC publishing, Apache-2.0 license.
- Honeywell Home API evaluation and typed contract (`docs/API.md`).
- OAuth2 `TokenManager` with optimistic startup, proactive/single-flight refresh, timeout + transient retry, rotation persistence, and differentiated credential vs. refresh-token errors (unit tested).
- `ResideoApiClient` with `apikey` + bearer injection, timeout, transient retry, and 401 refresh-and-retry (unit tested).
- Leak/temperature/humidity/battery/freeze HomeKit accessory mapping, with fault signaling on missing readings (unit tested with a mocked HAP surface).
- Config schema and platform discovery + polling, with self-healing discovery retry, bounded-concurrency polling + in-flight guard, stale-accessory pruning, atomic refresh-token persistence, and connectivity surfaced via `StatusActive` (unit tested).

## Next

- [ ] **Account-linking UI** — a `homebridge-ui` custom server implementing the OAuth2 Authorization Code flow on top of the existing API layer (currently tokens are obtained manually; see [`AUTH.md`](AUTH.md)).
- [ ] **Live verification** — validate against real hardware and confirm the `waterLeakDetectors` path/fields on the current API.
- [ ] **Alarm mapping** — consider surfacing `currentAlarms` (e.g. high humidity) as faults.
