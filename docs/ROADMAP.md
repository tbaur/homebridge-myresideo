# Roadmap

## Done (0.1.0 scaffold)

- Project foundation: strict TypeScript, ESLint flat config, Jest + coverage, PR CI matrix, release-please + OIDC publishing workflow (configured but currently disabled pending npm Trusted Publisher setup — see [`RELEASING.md`](../RELEASING.md)), Apache-2.0 license.
- Honeywell Home API evaluation and typed contract (`docs/API.md`).
- OAuth2 `TokenManager` with optimistic startup, proactive/single-flight refresh, timeout + transient retry, rotation persistence, and differentiated credential vs. refresh-token errors (unit tested).
- `ResideoApiClient` with `apikey` + bearer injection, timeout, transient retry, and 401 refresh-and-retry (unit tested).
- Leak/temperature/humidity/battery/freeze HomeKit accessory mapping, with fault signaling on missing readings (unit tested with a mocked HAP surface).
- Config schema and platform discovery + polling, with self-healing discovery retry, bounded-concurrency polling + in-flight guard, stale-accessory pruning, atomic refresh-token persistence, and connectivity surfaced via `StatusActive` (unit tested).
- Alarm & connectivity mapping: any active `currentAlarms` entry (e.g. `HighHumidity`, `DeviceOffline`) and an offline device are surfaced as a HomeKit `StatusFault` on the Leak Sensor (with stale readings faulted on the temperature/humidity/freeze services), and the active alarm type is logged once when it changes (unit + fixture tested).
- Account-linking UI: a custom Homebridge settings UI (`homebridge-ui/`, built on `@homebridge/plugin-ui-utils`) that runs the OAuth2 Authorization Code flow — sign in to Resideo from the plugin settings, paste back the redirected URL (or the `code` it carries), and the access/refresh tokens are exchanged and saved to the config. It works the same whether Homebridge is local or remote, and the `get-tokens` helper script remains as a command-line fallback (the token exchange is shared between both and unit tested; see [`AUTH.md`](AUTH.md)).

## Next

- [ ] **Live verification** — validate against real hardware and confirm the `waterLeakDetectors` path/fields on the current API.
