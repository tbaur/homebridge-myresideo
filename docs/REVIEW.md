# Security, Reliability, Maintainability & Serviceability Review

This document is a **point-in-time assessment** of the plugin against the engineering standard used across these Homebridge plugins. It reflects the current codebase after a principal-level audit and the resulting fixes, not a claim of zero defects. This is an early-stage plugin (0.x); some areas are intentionally lighter than a mature, realtime-push plugin because the Resideo / Honeywell Home API for leak detectors is **poll-only**.

---

## Security — Strong

| Area | Status | Notes |
|------|--------|-------|
| **Credential Handling** | ✅ | OAuth2 only; the plugin never sees the user's Resideo password |
| **Secret Redaction** | ✅ | `sanitizeError()` / `sanitizeString()` redact `apikey`, `Authorization`, bearer/basic credentials, access/refresh tokens, and the consumer/client secret; `maskToken()` correlates a rotated refresh token in debug logs without exposing it; token-endpoint response bodies are never logged |
| **Token Rotation** | ✅ | Rotated refresh tokens persisted back to `config.json` |
| **Input Validation** | ✅ | `validateConfig()` runs at startup; fatal errors stop the plugin with an actionable message |
| **HTTPS Only** | ✅ | All API calls to `https://api.honeywellhome.com` |
| **npm Audit / CI** | ✅ | Audit job runs in CI on every push and PR |

**Residual risk:** Homebridge stores the config (API key/secret/tokens) in plain text on the host (documented; mitigated via host hardening).

---

## Reliability — Strong

| Area | Status | Notes |
|------|--------|-------|
| **Token Lifecycle** | ✅ | Optimistic use of a supplied token; refresh-ahead before expiry and on `401`; single-flight de-duplication; default TTL when API omits `expires_in`; a minimum-lifetime floor prevents a pathologically short TTL from stampeding the auth endpoint |
| **Token Refresh Hardening** | ✅ | Refresh request is timeout-bounded and retries transient network/timeout/5xx failures with backoff |
| **Transient-Error Retry** | ✅ | Network/timeout/5xx/429 retried with jittered exponential backoff (shared with the token manager); a 429 `Retry-After` header is honored when present; 401 triggers one refresh-and-retry, while 403 (`ForbiddenError`) and other 4xx are not retried |
| **Request Timeouts** | ✅ | All requests (including token refresh) bounded so a stalled socket cannot wedge the poll loop |
| **Polling** | ✅ | Fixed cadence (120s default, 30s min); bounded concurrency (4) with an in-flight guard that skips overlapping ticks; immediate first poll after discovery |
| **Discovery Resilience** | ✅ | Self-healing retry with capped exponential backoff (15s → 5min) on transient errors; non-recoverable auth/config errors are not retried |
| **Accessory Lifecycle** | ✅ | Detectors removed from the account are unregistered; per-device poll failures are isolated |
| **Stale-Data Safety** | ✅ | Missing temperature/humidity raises `StatusFault`; absent battery is not asserted as a misleading default |
| **Config Persistence** | ✅ | Rotated refresh token written atomically (temp file + rename) to the matching platform block |

---

## Maintainability — Strong

| Area | Status | Notes |
|------|--------|-------|
| **TypeScript** | ✅ | Strict mode; production and tests compile under the same strict settings (`tsconfig.test.json`); HAP types from the `homebridge` dev dependency |
| **Test Coverage** | ✅ | **106 tests**, ~94% line / ~86% branch coverage across `src/` including `platform.ts` (~90%) and `leak-sensor.ts` (100%) |
| **Code Organization** | ✅ | `api/`, `devices/`, `utils/` (mappers/sanitizers/validators/backoff), `errors/`, `types/` |
| **Dependencies** | ✅ | Zero runtime dependencies (native `https`) |
| **Lint** | ✅ | ESLint flat config, 0 errors |

---

## Serviceability — Good

| Area | Status | Notes |
|------|--------|-------|
| **Logging** | ✅ | Uses the Homebridge logger; all error logging routed through `sanitizeError` |
| **Config Schema ↔ Validators** | ✅ | `config.schema.json` and `validateConfig` cover the same fields; `name` is optional in both |
| **Differentiated Errors** | ✅ | Invalid refresh token vs. rejected API credentials are logged distinctly so users know whether to re-link or fix credentials |
| **Structured Diagnostics** | ⚠️ | No diagnostics/health-heartbeat subsystem yet (deferred — see "Deliberately deferred") |
| **Integration Smoke Tests** | ✅ | `tests/integration/network.test.ts` exercises the native transport with `nock` (no live API) |

---

## Deliberately deferred (vs. the realtime-push sibling plugin)

These exist in the WebSocket-based sibling plugin but are **not** carried over, because they would be premature for a poll-only, single-device-type plugin (per the project's KISS guidance). They are revisited if scope or load justifies them:

- **WebSocket / realtime push** — the Honeywell Home leak-detector API exposes no documented push channel.
- **Rate limiter** — a single poll every ≥30s across a handful of devices does not approach API limits.
- **Circuit breaker / request queue** — retry-with-backoff plus bounded timeouts cover the current failure modes.
- **Diagnostics subsystem & structured JSON logging** — not warranted until field telemetry shows a need.

---

## Summary

| Category | Assessment |
|----------|------------|
| **Security** | Strong; documented config-secret residual risk |
| **Reliability** | Strong; token-refresh, discovery, polling, and persistence all hardened |
| **Maintainability** | Strong; small, well-tested (incl. platform/accessory), dependency-free core |
| **Serviceability** | Good; diagnostics subsystem intentionally deferred |

The remaining items for broad production sign-off are **feature/verification** work, not defects: a built-in account-linking UI (tokens are currently obtained manually) and live verification against real hardware. Both are tracked in [`ROADMAP.md`](ROADMAP.md).

### Overall: Early-stage, production-quality foundation

```
Tests:       106 passing (unit + integration smoke)
Coverage:    ~94% lines / ~86% branches across src/ (incl. platform.ts and leak-sensor.ts)
Lint:        0 errors
Audit:       run in CI on every push/PR
```
