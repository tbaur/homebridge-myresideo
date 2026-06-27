# Security Policy

## Reporting a Vulnerability

Please report security issues privately via GitHub's
[security advisory](https://github.com/tbaur/homebridge-myresideo/security/advisories/new)
feature rather than opening a public issue.

You can expect an initial response within a few days. Please include enough
detail to reproduce the issue.

## Handling of Secrets

- Resideo credentials (API key/secret, access/refresh tokens) live only in the
  user's Homebridge `config.json` and are never logged.
- The `apikey` query parameter is redacted from any logged URLs.
- Do not paste real tokens into issues or pull requests.
