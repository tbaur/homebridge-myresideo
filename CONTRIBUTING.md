# Contributing

Thanks for your interest in improving homebridge-myresideo!

## Development

```bash
npm install
npm run build      # compile TypeScript to dist/
npm run lint       # eslint
npm test           # jest with coverage (NODE_ENV=test)
```

See [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) for architecture notes.

## Commit style

This repo uses [Conventional Commits](https://www.conventionalcommits.org). PR titles drive automated releases via release-please, so use prefixes like `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.

## Pull requests

- Keep changes focused.
- Add or update tests for changed behavior; coverage must stay >= 80%.
- Ensure `npm run build`, `npm run lint`, and `npm test` all pass.
