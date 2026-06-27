# Tests

```bash
npm test               # all tests with coverage
npm run test:unit      # unit tests only
npm run test:integration  # integration tests only (no coverage gate)
```

- Tests must run with `NODE_ENV=test` (enforced by `tests/setup.js`).
- No real network calls: transports and the token requester are injectable and
  stubbed in unit tests; integration tests use `nock`.
- Coverage threshold: 80% (branches/functions/lines/statements) on the testable
  core.
