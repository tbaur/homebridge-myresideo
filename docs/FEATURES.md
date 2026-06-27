# Features

**homebridge-myresideo**

## Core Features

- ✅ Automatic device discovery from the Resideo / Honeywell Home cloud
- ✅ Stale-accessory pruning (detectors removed from the account are unregistered)
- ✅ Water leak detection exposed as a HomeKit Leak Sensor
- ✅ Temperature and humidity readings exposed as HomeKit sensors (optional, per device)
- ✅ Fault signaling on missing readings instead of showing stale values
- ✅ Freeze detection derived from temperature (optional Contact Sensor, per device)
- ✅ Battery level and low-battery status (no misleading default when unreported)
- ✅ Configurable polling (120s default, 30s minimum) with bounded concurrency and an in-flight guard
- ✅ OAuth2 with token auto-refresh before expiry and on `401`, optimistic use of a supplied token
- ✅ Refresh-token rotation persisted atomically back to `config.json`
- ✅ Automatic retry of transient network/timeout/5xx errors (API and token refresh) with exponential backoff
- ✅ Self-healing discovery retry after a transient startup outage
- ✅ Bounded request timeouts (including token refresh)
- ✅ Secret redaction in logs (apikey, bearer/basic auth, access/refresh tokens, consumer secret)
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
│   ├── api/              # OAuth2 token manager + HTTP client
│   ├── devices/          # HomeKit accessory handlers
│   ├── utils/            # Mappers, sanitizers, validators
│   ├── errors/           # Structured error hierarchy
│   └── types/            # TypeScript type definitions
├── dist/                 # Compiled JavaScript (auto-generated)
└── tests/
    ├── unit/*.test.ts    # Unit tests
    └── integration/      # nock-backed integration tests
```

## Quality

- Unit and integration test suites with an 80%+ coverage gate across the whole `src/` tree (statements, branches, functions, and lines)
- Platform and accessory layers unit-tested with a mocked HAP surface
- ESLint with zero warnings
- TypeScript strict mode — production and tests compile under the same strict settings
- JSDoc on public modules and exported helpers
- No runtime dependencies (native `https`)
