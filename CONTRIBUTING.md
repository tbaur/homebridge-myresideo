# Contributing to homebridge-myresideo

Thank you for your interest in contributing! This guide will help you get started.

## Getting Started

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/homebridge-myresideo.git
   cd homebridge-myresideo
   ```
3. Install dependencies:
   ```bash
   npm install
   ```

## Development Workflow

### Running Tests

```bash
npm test              # Run all tests with coverage
npm run lint          # Check code style
npm run lint:fix      # Auto-fix style issues
```

### Code Style

- Use `const`/`let`, never `var`
- Use async/await over raw Promises
- Add JSDoc comments for public functions
- Keep secrets out of logs — route error logging through `sanitizeError`
- Follow existing code patterns

### Making Changes

1. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. Make your changes
3. Add/update tests
4. Ensure all tests pass: `npm test` (coverage must stay >= 80%)
5. Ensure linting passes: `npm run lint`
6. Commit with a descriptive message

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org). PR titles drive automated releases via release-please, so use prefixes like:

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation only
- `test:` - Test changes
- `refactor:` - Code refactoring

Example: `feat: add temperature sensor for leak detectors`

## Pull Request Process

1. Update documentation if needed
2. Ensure CI passes (tests, linting)
3. Request review from maintainers

> `CHANGELOG.md` is generated automatically by release-please from your
> Conventional Commit / PR titles — do not edit it by hand. See [RELEASING.md](RELEASING.md).

### PR Checklist

- [ ] Tests added/updated
- [ ] Linting passes
- [ ] Documentation updated
- [ ] Descriptive PR title (Conventional Commits)

## Adding Device Support

See [DEVELOPMENT.md](DEVELOPMENT.md#adding-new-device-support) for details on adding support for new Resideo / Honeywell Home devices.

## Reporting Bugs

Use the GitHub issue template. Include:
- Homebridge version
- Plugin version
- Node.js version
- Steps to reproduce
- Expected vs actual behavior
- Relevant logs (with sensitive data like API keys/tokens redacted)

## Feature Requests

Open an issue with:
- Clear description of the feature
- Use case / why it's needed
- Any implementation ideas

## Questions?

Open a discussion on GitHub or check existing issues.

---

Thank you for contributing! 🎉
