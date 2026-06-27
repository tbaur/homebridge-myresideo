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
    auth.ts           OAuth2 TokenManager (refresh-ahead, single-flight, rotation).
    client.ts         HTTP client (apikey + bearer, timeout, retry, 401 handling).
    index.ts          Barrel exports.
  devices/
    leak-sensor.ts    HomeKit accessory: leak/temp/humidity/battery/freeze.
  utils/
    mappers.ts        Pure device-state → HomeKit mapping helpers.
    sanitizers.ts     Secret redaction / token masking for logs.
    validators.ts     Startup config validation.
    index.ts          Barrel exports.
```

## Design principles

- **No runtime dependencies.** Uses Node's native `https`. `homebridge` is a dev-only dependency (types) injected at runtime by the host.
- **Pure logic is isolated** in `utils/` and `errors/` so it is trivially unit-testable; network/HAP code accepts injectable transports for testing.
- **Strict TypeScript** (`noImplicitAny`, `noUnusedLocals`, etc.).
- **Fail fast on bad config.** `validateConfig` runs in the platform constructor; fatal errors stop the plugin with an actionable message, non-fatal issues log a warning and fall back to defaults.
- **Secrets never reach the log.** All error logging goes through `sanitizeError`, which redacts `apikey`, bearer tokens, and access/refresh tokens.

## Reliability & performance

This plugin talks to a **poll-based** REST API (Honeywell Home exposes no documented realtime push for leak detectors), so the resilience surface is deliberately smaller than a WebSocket-driven plugin:

- **Token lifecycle** — a config-supplied access token is used optimistically once, then access tokens refresh ahead of expiry and on `401`; concurrent refreshes are de-duplicated (single-flight); rotated refresh tokens are persisted back to `config.json` atomically (temp file + rename).
- **Transient-error retry** — network errors, timeouts, and `5xx` responses retry with exponential backoff; this applies to both API calls and the token-refresh request. Auth (`401`) and `4xx` (except 429) do not retry.
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
```

## Adding new device support

The plugin currently targets the WiFi Water Leak & Freeze Detector (`deviceClass: "LeakDetector"`). To add another Honeywell Home device type:

1. Model the API shape in `src/types/`.
2. Add a discovery predicate (mirroring `isWaterLeakDetector`) in `src/utils/mappers.ts`.
3. Add an accessory handler in `src/devices/` that maps API state to HAP services.
4. Register it in `platform.ts` discovery.
5. Add unit tests for the new mappers and integration coverage for the client path.
