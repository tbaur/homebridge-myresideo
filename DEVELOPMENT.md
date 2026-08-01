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
    client.ts         HTTP client (apikey + bearer, timeout, retry, 401 handling,
                      circuit breaker).
    circuit-breaker.ts  Fail-fast protection for sustained Resideo API outages.
    index.ts          Barrel exports.
  devices/
    leak-sensor.ts    HomeKit accessory: leak/temp/humidity/battery/freeze.
  diagnostics/
    collector.ts      Opt-in health/activity collector: accumulates counters +
                      a latency window and renders heartbeat/snapshot reports
                      and a healthy/degraded rollup (no network I/O).
  utils/
    backoff.ts        Jittered exponential-backoff + delay helpers (shared).
    mappers.ts        Pure device-state → HomeKit mapping helpers.
    sanitizers.ts     Secret redaction for error/log strings.
    validators.ts     Startup config validation.
    index.ts          Barrel exports.
homebridge-ui/        Custom Homebridge settings UI (account linking).
  handlers.js         Pure OAuth helpers (authorize URL + code exchange) used
                      by the UI server and covered by unit tests.
  server.js           Wraps handlers.js behind @homebridge/plugin-ui-utils
                      request handlers.
  public/index.html   "Link your Resideo account" panel; renders the schema
                      form beneath it for the remaining options.
scripts/
  get-tokens.mjs      Dev helper: runs the OAuth2 Authorization Code flow to
                      obtain the initial refresh/access tokens (see docs/AUTH.md).
```

## Design principles

- **Dependency-light by design.** The Homebridge plugin runtime uses Node's native `https` and pulls in no third-party code. The package declares a single runtime dependency, `@homebridge/plugin-ui-utils` (itself dependency-free), used only by the optional custom settings UI that the Homebridge UI runs out-of-process — it is never loaded by the plugin at runtime. `homebridge` is a dev-only dependency (types) injected at runtime by the host, and `npm audit --omit=dev` reports zero advisories.
- **Dev-dependency hygiene.** Two `overrides` entries pin transitive dev dependencies away from known advisories: `js-yaml` to `^4.2.0`, eliminating a moderate advisory (GHSA-h67p-54hq-rp68) that reached `js-yaml@3.x` via jest's coverage chain (`babel-plugin-istanbul` → `@istanbuljs/load-nyc-config`), and `brace-expansion` to `5.0.8`. Both are dev-only and never shipped.
- **Pure logic is isolated** in `utils/` and `errors/` so it is trivially unit-testable; network/HAP code accepts injectable transports for testing.
- **Strict TypeScript** (`noImplicitAny`, `noUnusedLocals`, etc.).
- **Fail fast on bad config.** `validateConfig` runs in the platform constructor; fatal errors stop the plugin with an actionable message, non-fatal issues log a warning and fall back to defaults.
- **Secrets never reach the log.** All error logging goes through `sanitizeError`, which redacts the API Key and Secret (`consumerKey` / `consumerSecret` / `client_id` / `client_secret`), access and refresh tokens, the `apikey` query parameter, and `Authorization` headers in both `Bearer` and `Basic` form.

## Reliability & performance

This plugin talks to a **poll-based** REST API, so its resilience focuses on making each polling cycle robust:

- **Token lifecycle** — a config-supplied access token is used optimistically once, then access tokens refresh ahead of expiry and on `401`; concurrent refreshes are de-duplicated (single-flight); after every successful refresh the current refresh + access tokens are persisted back to `config.json` atomically (temp file + rename; on Windows rename-aside with restore-on-failure; pretty-printed whole-file rewrite).
- **Transient-error retry** — API calls and token refresh retry network errors, timeouts, `5xx`, and `429` with jittered exponential backoff; both honor a `429` `Retry-After` header when present. `401` on an API call triggers one refresh-and-retry (including when the 401 arrives on the final attempt budget); `403` (`ForbiddenError`) and other non-retryable `4xx` do not retry.
- **Circuit breaker** — after a threshold of service-health failures (5xx/network/timeout/parse), the breaker opens and subsequent requests fail fast until a cooldown elapses; a single half-open probe decides whether to close again (avoids races with concurrent device polls). Transitions log at warn (OPEN) / info (HALF_OPEN probe and CLOSED recovery). Per-device transient poll misses stay at debug; auth/re-link failures still log once per poll cycle at error.
- **Poll freshness bound** — detectors typically upload to the cloud only 1–3×/day (`lastCheckin`); `refreshRate` bounds how often the plugin asks Resideo for the latest cloud snapshot, not how often the physical device reports.
- **Bounded timeouts** — every request, including token refresh, has a timeout so a stalled connection cannot wedge the poll loop.
- **Self-healing discovery** — if initial discovery fails on a transient error, it retries with jittered capped exponential backoff (15s → 5min). Non-recoverable errors (invalid refresh token, rejected credentials) are not retried. An HTTP 200 that returns zero detectors is also retried (warn, skip stale removal when cache remains, restore handlers from cache when `locationId` is known) so a Resideo outage cannot wipe HomeKit or leave a wiped bridge idle until a manual restart. Empty-discovery and retry notices demote to debug after the first three attempts, with one info line at that transition (`Retrying discovery every 300s (next message upon recovery)`) so quiet does not look like the plugin gave up. A non-empty but partial list only removes a missing detector after `STALE_REMOVAL_CONFIRMATIONS` (3) consecutive omissions — empty responses do not count. Removals are also blocked while the platform is unstable (circuit breaker not CLOSED, empty-discovery retry active, or diagnostics health degraded). In-flight poll workers stop claiming new devices once shutdown begins.
- **Bounded-concurrency polling** — devices are polled up to `POLL_DEVICE_CONCURRENCY` (4) at a time, with an in-flight guard that skips a tick if the previous cycle is still running.
- **Stale-data handling** — missing temperature/humidity/battery readings raise a `StatusFault` instead of silently retaining a stale value; a missing battery reading is never asserted as a misleading 100% default.
- **Polling cadence** — default 120s, configurable, clamped to a 30s minimum to avoid hammering the API.
- **Diagnostics** — when `diagnosticsInterval > 0` (schema default 10800; `0` disables), a `DiagnosticsCollector` accumulates in-memory counters (fed by client `metrics`/`onRetry` hooks, token-refresh callbacks, and poll-cycle results) and emits a periodic heartbeat plus boot/shutdown snapshots. The human line stays quiet (`devices`, poll outcome, API p50/p95), surfacing leak count and breaker state only when they carry signal; full counters remain in the optional structured JSON. Reads are synchronous and never touch the network; all emission is wrapped so a diagnostics failure can never crash the host. The config echo in snapshots is redacted (no credentials).

## Testing

- Unit tests live in `tests/unit/` and inject fakes (no real network). The platform and the leak-sensor accessory are unit-tested with a mocked Homebridge/HAP surface; `node:fs` is mocked for the config-persistence path.
- Integration tests live in `tests/integration/` and use `nock` to exercise the native `https` transport and token requester.
- Tests compile under the same strict TypeScript settings as production (`tsconfig.test.json`).
- Coverage threshold is 80% across statements, branches, functions, and lines for the whole `src/` tree (only barrel files and `settings.ts` are excluded).

Requires **Node.js 20 or newer**, matching the `engines` range in `package.json`. CI runs this suite on Node 20, 22, and 24.

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
