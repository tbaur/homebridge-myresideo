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
  utils.ts            Pure mapping helpers (freeze, battery, leak).
```

## Design principles

- **No runtime dependencies.** Uses Node's native `https`. `homebridge` is a
  dev-only dependency (types) injected at runtime by the host.
- **Pure logic is isolated** in `utils.ts` and `errors/` so it is trivially
  unit-testable; network/HAP code accepts injectable transports for testing.
- **Strict TypeScript** (`noImplicitAny`, `noUnusedLocals`, etc.).

## Testing

- Unit tests live in `tests/unit/` and inject fakes (no real network).
- Integration tests (planned) live in `tests/integration/` and use `nock`.
- Coverage threshold is 80% on the testable core (HAP adapters and the platform
  are excluded from unit coverage and covered by integration tests).
