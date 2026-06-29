# Development

## Architecture

```
src/
  index.ts            Entry point; registers the dynamic platform.
  settings.ts         Constants + API endpoints (api.honeywellhome.com).
  platform.ts         Discovery, accessory lifecycle, polling, token persistence.
  types/              Plugin config + Honeywell API types.
  errors/             Structured, typed error hierarchy with retry hints.
  api/
    auth.ts           OAuth2 TokenManager (refresh-ahead, single-flight, rotation)
                      plus the authorize-URL / code-exchange helpers shared by the
                      account-linking UI and the get-tokens script.
    client.ts         HTTP client (apikey + bearer, timeout, retry, 401 handling).
    index.ts          Barrel exports.
  devices/
    leak-sensor.ts    HomeKit accessory: leak/temp/humidity/battery/freeze.
  utils/
    backoff.ts        Jittered exponential-backoff + delay helpers (shared).
    mappers.ts        Pure device-state → HomeKit mapping helpers.
    sanitizers.ts     Secret redaction / token masking for logs.
    validators.ts     Startup config validation.
    index.ts          Barrel exports.
homebridge-ui/        Custom Homebridge settings UI (account linking).
  server.js           Wraps the compiled dist/ OAuth2 helpers behind
                      @homebridge/plugin-ui-utils request handlers.
  public/index.html   "Link your Resideo account" panel; renders the schema
                      form beneath it for the remaining options.
scripts/
  get-tokens.mjs      Dev helper: runs the OAuth2 Authorization Code flow to
                      obtain the initial refresh/access tokens (see docs/AUTH.md).
```

## Design principles

- **Dependency-light by design.** The Homebridge plugin runtime uses Node's native `https` and pulls in no third-party code. The package declares a single runtime dependency, `@homebridge/plugin-ui-utils` (itself dependency-free), used only by the optional custom settings UI that the Homebridge UI runs out-of-process — it is never loaded by the plugin at runtime. `homebridge` is a dev-only dependency (types) injected at runtime by the host, and `npm audit --omit=dev` reports zero advisories.
- **Dev-dependency hygiene.** A single `overrides` entry pins `js-yaml` to `^4.2.0` across the dev tree, eliminating a transitive moderate advisory (GHSA-h67p-54hq-rp68) that reached `js-yaml@3.x` via jest's coverage chain (`babel-plugin-istanbul` → `@istanbuljs/load-nyc-config`). It is dev-only and never shipped.
- **Pure logic is isolated** in `utils/` and `errors/` so it is trivially unit-testable; network/HAP code accepts injectable transports for testing.
- **Strict TypeScript** (`noImplicitAny`, `noUnusedLocals`, etc.).
- **Fail fast on bad config.** `validateConfig` runs in the platform constructor; fatal errors stop the plugin with an actionable message, non-fatal issues log a warning and fall back to defaults.
- **Secrets never reach the log.** All error logging goes through `sanitizeError`, which redacts `apikey`, bearer tokens, and access/refresh tokens.

## Reliability & performance

This plugin talks to a **poll-based** REST API, so its resilience focuses on making each polling cycle robust:

- **Token lifecycle** — a config-supplied access token is used optimistically once, then access tokens refresh ahead of expiry and on `401`; concurrent refreshes are de-duplicated (single-flight); rotated refresh tokens are persisted back to `config.json` atomically (temp file + rename).
- **Transient-error retry** — network errors, timeouts, `5xx`, and `429` responses retry with jittered exponential backoff (a `429` `Retry-After` header is honored when present); this applies to both API calls and the token-refresh request. `401` triggers one refresh-and-retry; `403` (`ForbiddenError`) and other `4xx` do not retry.
- **Bounded timeouts** — every request, including token refresh, has a timeout so a stalled connection cannot wedge the poll loop.
- **Self-healing discovery** — if initial discovery fails on a transient error, it retries with capped exponential backoff (15s → 5min). Non-recoverable errors (invalid refresh token, rejected credentials) are not retried.
- **Bounded-concurrency polling** — devices are polled up to `POLL_DEVICE_CONCURRENCY` (4) at a time, with an in-flight guard that skips a tick if the previous cycle is still running.
- **Stale-data handling** — missing temperature/humidity readings raise a `StatusFault` instead of silently retaining a stale value; a missing battery reading is not asserted as a misleading default.
- **Polling cadence** — default 120s, configurable, clamped to a 30s minimum to avoid hammering the API.

## Testing

- Unit tests live in `tests/unit/` and inject fakes (no real network). The platform and the leak-sensor accessory are unit-tested with a mocked Homebridge/HAP surface; `node:fs` is mocked for the config-persistence path.
- Integration tests live in `tests/integration/` and use `nock` to exercise the native `https` transport and token requester.
- Tests compile under the same strict TypeScript settings as production (`tsconfig.test.json`).
- Coverage threshold is 80% across statements, branches, functions, and lines for the whole `src/` tree (only barrel files and `settings.ts` are excluded).

```bash
npm install
npm run build          # compile TypeScript to dist/
npm run lint           # eslint
npm test               # jest with coverage (NODE_ENV=test)
npm run test:unit      # unit tests only
npm run test:integration   # nock-backed integration tests
npm run get-tokens         # obtain initial OAuth2 tokens (prompts for key/secret; see docs/AUTH.md)
```

## Adding new device support

The plugin currently targets the WiFi Water Leak & Freeze Detector (`deviceClass: "LeakDetector"`). To add another Honeywell Home device type:

1. Model the API shape in `src/types/`.
2. Add a discovery predicate (mirroring `isWaterLeakDetector`) in `src/utils/mappers.ts`.
3. Add an accessory handler in `src/devices/` that maps API state to HAP services.
4. Register it in `platform.ts` discovery.
5. Add unit tests for the new mappers and integration coverage for the client path.
