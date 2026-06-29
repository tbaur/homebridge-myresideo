# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | ✅ Active support  |
| < 1.0   | ❌ Deprecated — please upgrade |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT open a public issue**
2. Email the maintainer directly or use GitHub's [private vulnerability reporting](https://github.com/tbaur/homebridge-myresideo/security/advisories/new)
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Any suggested fixes

## Security Measures

This plugin implements:

- **HTTPS only** - All API communication uses TLS to `https://api.honeywellhome.com`
- **OAuth2, no password storage** - The plugin never sees or stores your Resideo password; it exchanges an authorization code for access/refresh tokens
- **Token auto-refresh and rotation** - Access tokens are refreshed before expiry and on `401`; rotated refresh tokens are persisted back to the Homebridge config
- **Secret redaction in logs** - The `apikey` query parameter, bearer tokens, and `Authorization` headers are masked; errors are sanitized before logging
- **Input validation** - All configuration inputs are validated at startup; invalid config fails fast with a clear message
- **Request timeouts** - All API calls have bounded timeouts to avoid hanging the event loop
- **Dependency auditing** - `npm audit` runs in CI on every push and pull request

## Best Practices for Users

1. Treat your Resideo developer **API key** and **secret** like passwords — never share them or commit them to source control
2. Keep Homebridge and this plugin updated
3. Run Homebridge with minimal system privileges
4. Use Homebridge's secure remote access features rather than exposing it directly to the internet

## Token & Credential Handling

- The `consumerKey` (API key), `consumerSecret`, and tokens are read from the Homebridge platform config. Homebridge stores this config in plain text on the host, so host hardening is the primary mitigation.
- Refresh-token rotation is handled automatically: when Resideo returns a new refresh token, the plugin writes it back to `config.json` so the next restart uses the current token.
- No credentials, tokens, or personally identifying information are written to logs.

## Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix timeline**: Depends on severity
  - Critical: 24-48 hours
  - High: 1 week
  - Medium: 2 weeks
  - Low: Next release
