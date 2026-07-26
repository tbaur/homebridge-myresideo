# Features

**homebridge-myresideo**

## Core Features

- ✅ Automatic device discovery from the Resideo / Honeywell Home cloud at startup (restart Homebridge to pick up newly-added detectors)
- ✅ Stale-accessory pruning (detectors removed from the account are unregistered)
- ✅ Water leak detection exposed as a HomeKit Leak Sensor
- ✅ Temperature and humidity readings exposed as HomeKit sensors (optional, per device)
- ✅ Fault signaling on missing readings instead of showing stale values (temperature, humidity, and battery raise `StatusFault` when a prior reading disappears)
- ✅ Connectivity & alarm faults: an offline device or any active `currentAlarms` entry (e.g. `HighHumidity`, `DeviceOffline`) is surfaced as a HomeKit `StatusFault`, and the alarm type is logged when it changes
- ✅ State-change logging: each poll logs leak, connectivity, low-battery, freeze, and alarm transitions once when they change (not every cycle), with a full per-device snapshot available at debug level
- ✅ Quiet poll misses: per-device transient poll failures log at debug with the detector name (`Polling skipped for …`); auth/re-link failures still surface once per poll cycle at error; operators see API outages via circuit-breaker OPEN (warn) / HALF_OPEN+CLOSED (info) instead of per-device error spam
- ✅ Per-check-in reporting: when a detector reports in to the cloud (on its configured check-in period — the Resideo app's 1–3×/day update frequency), a one-line summary prefixed with the detector's name logs its current readings and the poll latency, so the log reflects each device update without per-poll noise. Note: `refreshRate` bounds how often the plugin asks Resideo for the latest cloud snapshot; HomeKit freshness for leak/sensor data is still bounded by how often the physical detector uploads (`lastCheckin`)
- ✅ Opt-in health diagnostics (`diagnosticsInterval`): a periodic heartbeat reporting API latency (p50/p95), poll success/failure, circuit-breaker state/trips, token expiry, device online/leak/low-battery counts, and a `healthy`/`degraded` rollup (circuit breaker open, high API error rate, token-refresh failure, empty-discovery retry, or a fully-failed poll cycle), with boot/shutdown snapshots, healthy↔degraded transition logs, and optional structured-JSON output (`structuredLogs`)
- ✅ Freeze detection derived from temperature (optional Contact Sensor, per device)
- ✅ Battery level and low-battery status (no misleading default when unreported)
- ✅ Configurable polling (120s default, 30s minimum) with bounded concurrency and an in-flight guard
- ✅ OAuth2 with token auto-refresh before expiry and on `401`, optimistic use of a supplied token
- ✅ Built-in account-linking UI (custom Homebridge settings panel) that runs the OAuth2 flow and saves your tokens; a `get-tokens` script remains as a command-line fallback
- ✅ OAuth2 `state` round-trip on account linking (UI and `get-tokens`) to reject mismatched redirects; the settings UI keeps CSRF `state` on the UI server only (not in browser storage)
- ✅ Refresh + access tokens persisted atomically back to `config.json` after every successful refresh (cross-platform replace)
- ✅ Automatic retry of transient network/timeout/5xx/429 errors (API and token refresh) with exponential backoff; both honor `Retry-After` when present
- ✅ Circuit breaker for sustained Resideo API outages (fail-fast while open; single half-open probe after cooldown; transitions logged)
- ✅ Self-healing discovery retry after a transient startup outage (including empty/partial cloud payloads; stale removal requires repeated confirmation and is blocked while degraded / breaker open / empty-discovery)
- ✅ Bounded request timeouts (including token refresh)
- ✅ Secret redaction in logs (apikey, bearer/basic auth, access/refresh tokens, consumer secret); API errors use short status text without query strings
- ✅ Startup config validation (fail fast with actionable messages); distinguishes a bad refresh token from rejected API credentials
- ✅ Homebridge v1.6.0+ and v2.0+ support
- ✅ Node.js 20+ support

## Supported Devices

| Type | Honeywell `deviceClass` | HomeKit services |
|------|-------------------------|------------------|
| **WiFi Water Leak & Freeze Detector** | `LeakDetector` | Leak Sensor, Temperature Sensor, Humidity Sensor, Battery, Contact Sensor (freeze) |

## Architecture

```
homebridge-myresideo/
├── src/
│   ├── index.ts          # Homebridge entry point
│   ├── platform.ts       # Platform plugin (discovery, polling, HomeKit services)
│   ├── settings.ts       # Constants + API endpoints
│   ├── api/              # OAuth2 token manager, HTTP client, circuit breaker
│   ├── devices/          # HomeKit accessory handlers
│   ├── diagnostics/      # Opt-in health/activity metrics collector
│   ├── utils/            # Mappers, sanitizers, validators, backoff
│   ├── errors/           # Structured error hierarchy
│   └── types/            # TypeScript type definitions
├── homebridge-ui/        # Custom settings UI: handlers.js + server.js + public/
├── dist/                 # Compiled JavaScript (auto-generated)
└── tests/
    ├── unit/*.test.ts    # Unit tests
    └── integration/      # nock-backed integration tests
```

## Quality

- Unit and integration test suites with an 80%+ coverage gate (statements, branches, functions, and lines) across `src/`, excluding re-export `index.ts` barrels and the static `settings.ts` constants
- Platform and accessory layers unit-tested with a mocked HAP surface
- ESLint with zero warnings
- TypeScript strict mode — production and tests compile under the same strict settings
- JSDoc on public modules and exported helpers
- Lean dependencies: the plugin core uses Node's native `https`; the only runtime dependency, `@homebridge/plugin-ui-utils`, is itself dependency-free and used solely by the optional account-linking UI
