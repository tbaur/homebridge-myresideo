# Security, Reliability, Maintainability & Serviceability Review

This document summarizes the plugin's security, reliability, maintainability, and serviceability posture and the practices that uphold it. The Resideo / Honeywell Home API for leak detectors is **poll-only**, so the design centers on resilient polling, robust OAuth2 token handling, and careful failure isolation.

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
| **Stale-Data Safety** | ✅ | Missing/stale temperature/humidity and an offline device or active alarm raise `StatusFault`; absent battery is not asserted as a misleading default |
| **Config Persistence** | ✅ | Rotated refresh token written atomically (temp file + rename) to the matching platform block |

---

## Maintainability — Strong

| Area | Status | Notes |
|------|--------|-------|
| **TypeScript** | ✅ | Strict mode; production and tests compile under the same strict settings (`tsconfig.test.json`); HAP types from the `homebridge` dev dependency |
| **Test Coverage** | ✅ | Unit + integration suites with a ≥80% coverage gate across `src/`, including the platform and accessory layers (mocked HAP surface) |
| **Code Organization** | ✅ | `api/`, `devices/`, `utils/` (mappers/sanitizers/validators/backoff), `errors/`, `types/` |
| **Dependencies** | ✅ | Plugin core has zero runtime dependencies (native `https`); the lone runtime dependency, `@homebridge/plugin-ui-utils`, is itself dependency-free and used only by the optional account-linking UI |
| **Lint** | ✅ | ESLint flat config, 0 errors |

---

## Serviceability — Good

| Area | Status | Notes |
|------|--------|-------|
| **Logging** | ✅ | Uses the Homebridge logger; all error logging routed through `sanitizeError` |
| **Config Schema ↔ Validators** | ✅ | `config.schema.json` and `validateConfig` cover the same fields; `name` is optional in both |
| **Differentiated Errors** | ✅ | Invalid refresh token vs. rejected API credentials are logged distinctly so users know whether to re-link or fix credentials |
| **Structured Diagnostics** | ⚠️ | No dedicated diagnostics/health-heartbeat subsystem; standard logging covers current needs |
| **Integration Smoke Tests** | ✅ | `tests/integration/network.test.ts` exercises the native transport with `nock` (no live API) |

---

## Scope

The plugin targets a single device type (the WiFi Water Leak & Freeze Detector) over a poll-only REST API, and is intentionally kept small, with a dependency-free runtime core (the optional account-linking UI adds a single, dependency-free package). Heavier infrastructure — a dedicated diagnostics subsystem and structured JSON logging — is not part of the current design; it can be added if field needs justify it. Adding support for other Honeywell Home device types is outlined in [`DEVELOPMENT.md`](../DEVELOPMENT.md).

---

## Summary

| Category | Assessment |
|----------|------------|
| **Security** | Strong; documented config-secret residual risk |
| **Reliability** | Strong; token-refresh, discovery, polling, and persistence all hardened |
| **Maintainability** | Strong; small, well-tested (incl. platform/accessory), dependency-free core |
| **Serviceability** | Good; standard logging, no dedicated diagnostics subsystem |

A built-in account-linking UI — completing the OAuth2 flow from the plugin settings, with the `get-tokens` script as a command-line fallback — ships in this version. Remaining planned work (e.g. live-hardware verification) is tracked in [`ROADMAP.md`](ROADMAP.md).

### Quality gates

- **Tests** — unit + integration (nock-backed) suites, run in CI.
- **Coverage** — ≥80% gate across statements, branches, functions, and lines for `src/`.
- **Lint** — ESLint flat config, zero errors.
- **Audit** — `npm audit` runs in CI on every push and pull request.
