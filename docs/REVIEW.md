# Security, Reliability, Maintainability & Serviceability Review

This document summarizes the plugin's security, reliability, maintainability, and serviceability posture and the practices that uphold it. The Resideo / Honeywell Home API for leak detectors is **poll-only**, so the design centers on resilient polling, robust OAuth2 token handling, and careful failure isolation.

---

## Security — Strong

| Area | Status | Notes |
|------|--------|-------|
| **Credential Handling** | ✅ | OAuth2 only; the plugin never sees the user's Resideo password |
| **OAuth `state`** | ✅ | Account-linking UI and `get-tokens` send an opaque CSPRNG `state` on authorize; the UI server retains `state` in memory (never `sessionStorage`) and verifies it on `/exchange-code` (no fail-open); mismatched redirects are rejected |
| **Secret Redaction** | ✅ | `sanitizeError()` / `sanitizeString()` redact `apikey`, `Authorization`, bearer/basic credentials, access/refresh tokens, and the consumer/client secret; no credentials or tokens (including masked fragments) are written to logs; token-endpoint response bodies are never logged |
| **Token Persistence** | ✅ | Refresh + access tokens persisted to `config.json` after every successful refresh (atomic replace; Windows rename-aside with restore-on-failure) |
| **Input Validation** | ✅ | `validateConfig()` runs at startup; fatal errors stop the plugin with an actionable message |
| **HTTPS Only** | ✅ | All API calls to `https://api.honeywellhome.com` |
| **npm Audit / CI** | ✅ | Audit job runs in CI on every push and PR |

**Residual risk:** Homebridge stores the config (API key/secret/tokens) in plain text on the host (documented; mitigated via host hardening).

---

## Reliability — Strong

| Area | Status | Notes |
|------|--------|-------|
| **Token Lifecycle** | ✅ | Optimistic use of a supplied token; refresh-ahead before expiry and on `401`; single-flight de-duplication; default TTL when API omits `expires_in`; a minimum-lifetime floor prevents a pathologically short TTL from stampeding the auth endpoint |
| **Token Refresh Hardening** | ✅ | Refresh request is timeout-bounded and retries transient network/timeout/5xx/429 failures with backoff; honors `Retry-After` on 429 |
| **Transient-Error Retry** | ✅ | API client and token manager both retry network/timeout/5xx/429 with jittered exponential backoff and honor `Retry-After` when present; 401 triggers one refresh-and-retry (including on the final attempt budget), while 403 (`ForbiddenError`) and other non-retryable 4xx are not retried |
| **Circuit Breaker** | ✅ | Sustained 5xx/network/timeout/parse failures open the breaker after a threshold; open state fails fast without network I/O; a single half-open probe after cooldown (avoids concurrent-probe races with the poll fan-out); any terminal half-open outcome (including auth/4xx) releases the probe back to OPEN so the breaker cannot wedge; OPEN logged at warn, HALF_OPEN/CLOSED at info; late failures while already OPEN do not extend the cooldown; an in-flight success while OPEN closes immediately; 4xx/auth do not trip the breaker while CLOSED |
| **Request Timeouts** | ✅ | All requests (including token refresh) bounded so a stalled socket cannot wedge the poll loop |
| **Polling** | ✅ | Fixed cadence (120s default, 30s min); bounded concurrency (4) with an in-flight guard that skips overlapping ticks; immediate first poll after discovery; per-device poll misses log at debug |
| **Discovery Resilience** | ✅ | Self-healing retry with capped exponential backoff (15s → 5min) on transient errors; non-recoverable auth/config errors are not retried |
| **Accessory Lifecycle** | ✅ | Detectors removed from the account are unregistered; per-device poll failures are isolated |
| **Stale-Data Safety** | ✅ | Missing/stale temperature/humidity/battery and an offline device or active alarm raise `StatusFault`; absent battery is never asserted as a misleading 100% default |
| **Config Persistence** | ✅ | Refresh + access tokens written atomically (temp file + rename; Windows rename-aside with restore-on-failure) to the matching platform block after every successful refresh; rewrites `config.json` as pretty-printed JSON |

---

## Maintainability — Strong

| Area | Status | Notes |
|------|--------|-------|
| **TypeScript** | ✅ | Strict mode; production and tests compile under the same strict settings (`tsconfig.test.json`); HAP types from the `homebridge` dev dependency |
| **Test Coverage** | ✅ | Unit + integration suites with a ≥80% coverage gate across `src/`, including the platform and accessory layers (mocked HAP surface) |
| **Code Organization** | ✅ | `api/` (client, auth, circuit-breaker), `devices/`, `utils/` (mappers/sanitizers/validators/backoff), `errors/`, `types/` |
| **Dependencies** | ✅ | Plugin core has zero runtime dependencies (native `https`); the lone runtime dependency, `@homebridge/plugin-ui-utils`, is itself dependency-free and used only by the optional account-linking UI |
| **Lint** | ✅ | ESLint flat config, 0 errors |

---

## Serviceability — Good

| Area | Status | Notes |
|------|--------|-------|
| **Logging** | ✅ | Uses the Homebridge logger; all error logging routed through `sanitizeError` |
| **Config Schema ↔ Validators** | ✅ | `validateConfig` enforces credentials at startup and sanitizes/warns on options (refresh rate, freeze thresholds, diagnostics interval, incomplete device overrides); `config.schema.json` declares both the user-editable options and the `credentials` object (so config-ui-x preserves the saved tokens), but keeps `credentials` out of the rendered `layout` so they are managed by the account-linking UI rather than shown in the form. A schema regression test (`tests/unit/config-schema.test.ts`) locks in this contract, and additionally asserts the schema stays valid draft-07 JSON Schema (`required` declared only as arrays, never a boolean on a field), requires the platform `name`, and keeps the per-device `items` free of `default`s and a `deviceID` `required` constraint — so config-ui-x cannot fabricate a phantom override that then fails validation on a fresh install. The plugin instead validates/ignores incomplete overrides at startup (`validateConfig`) |
| **Differentiated Errors** | ✅ | Invalid refresh token, rejected API credentials, 403 permissions, and other auth failures are logged with distinct operator guidance |
| **Structured Diagnostics** | ✅ | Opt-in diagnostics subsystem (`diagnosticsInterval`): a periodic heartbeat with API latency (p50/p95), poll success/failure, circuit-breaker state/trips, token expiry, device gauges, and a `healthy`/`degraded` rollup (including `circuitBreakerOpen`); boot/shutdown snapshots carry a redacted config echo; `structuredLogs` adds machine-readable JSON. Disabled by default; all emission is failure-isolated so it can never crash the host |
| **Integration Smoke Tests** | ✅ | `tests/integration/network.test.ts` exercises the native transport with `nock` (no live API) |

---

## Scope

The plugin targets a single device type (the WiFi Water Leak & Freeze Detector) over a poll-only REST API, and is intentionally kept small, with a dependency-free runtime core (the optional account-linking UI adds a single, dependency-free package). An opt-in diagnostics subsystem (periodic health heartbeat with optional structured JSON logging) is available but off by default, so the steady-state footprint stays minimal. Adding support for other Honeywell Home device types is outlined in [`DEVELOPMENT.md`](../DEVELOPMENT.md).

---

## Summary

| Category | Assessment |
|----------|------------|
| **Security** | Strong; documented config-secret residual risk |
| **Reliability** | Strong; token-refresh, discovery, polling, and persistence all hardened |
| **Maintainability** | Strong; small, well-tested (incl. platform/accessory), dependency-free core |
| **Serviceability** | Good; standard logging plus an opt-in diagnostics/health-heartbeat subsystem |

A built-in account-linking UI — completing the OAuth2 flow from the plugin settings, with the `get-tokens` script as a command-line fallback — ships in this version. The main remaining item, validation against real hardware, is tracked in the [issue tracker](https://github.com/tbaur/homebridge-myresideo/issues).

### Quality gates

- **Tests** — unit + integration (nock-backed) suites, run in CI.
- **Coverage** — ≥80% gate across statements, branches, functions, and lines for `src/`.
- **Lint** — ESLint flat config, zero errors.
- **Audit** — `npm audit` runs in CI on every push and pull request.
