# Account Linking & Token Lifecycle

## Getting credentials

1. Sign in / register at <https://developer.honeywellhome.com/user>.
2. Create a new application; give it a name.
3. Set the **Callback (Redirect) URL** to a localhost URL you will use with the helper script below. The default the script expects is `http://localhost:8581/oauth/callback`; if you register a different value, pass it via `--redirect-uri`. It must match byte-for-byte.
4. Copy the generated **Consumer Key (API Key)** and **Consumer Secret (API Secret)**.
5. Run the helper script (see below) to obtain the initial `accessToken` / `refreshToken`, then paste them into the plugin config.

> **The account-linking UI is on the roadmap (see [`ROADMAP.md`](ROADMAP.md)) and is not available yet.** Until then, use the `get-tokens` helper script to complete the Authorization Code flow, then paste the resulting tokens into the plugin config.

## Obtaining tokens with the `get-tokens` helper

The repository ships a one-off script that runs the OAuth2 Authorization Code flow for you. It starts a temporary localhost server on your registered redirect URI, opens the Resideo authorize page in your browser, captures the returned `code`, exchanges it for tokens, and prints a ready-to-paste `credentials` block. The token exchange itself is the same code the plugin uses at runtime (`src/api/auth.ts`) and is covered by unit tests.

From a clone of this repository:

```bash
npm install            # also builds dist/ via the prepare script
npm run get-tokens -- --key <CONSUMER_KEY> --secret <CONSUMER_SECRET>
```

If you registered a redirect URI other than the default, pass it explicitly:

```bash
npm run get-tokens -- \
  --key <CONSUMER_KEY> \
  --secret <CONSUMER_SECRET> \
  --redirect-uri http://localhost:8581/oauth/callback
```

Credentials and the redirect URI may also be supplied via the `RESIDEO_CONSUMER_KEY`, `RESIDEO_CONSUMER_SECRET`, and `RESIDEO_REDIRECT_URI` environment variables instead of flags. The redirect URI must point at `localhost` or `127.0.0.1` so the script can receive the redirect, and must match the value registered on your developer application exactly. The script prints your tokens to the terminal only — nothing is written to disk or sent anywhere except Resideo's token endpoint.

## How the plugin manages tokens

Resideo issues short-lived access tokens (~30 minutes) alongside a rotating refresh token. The `TokenManager` (`src/api/auth.ts`) keeps authentication robust without manual intervention:

- **Optimistic startup** — a config-supplied `accessToken` (whose true expiry is unknown) is used once, then the plugin refreshes from the `refreshToken`. The `accessToken` is therefore optional.
- **Proactive refresh** — refreshes one minute before `expires_in` elapses, so an in-flight poll never races an expiry.
- **Single-flight** — concurrent callers share one refresh request.
- **Bounded + retried** — the refresh request has a timeout and retries transient network/timeout/5xx failures with backoff, so one blip doesn't fail a whole cycle.
- **Rotation persistence** — when Resideo returns a new `refresh_token`, it is written back to `config.json` atomically (temp file + rename) so it survives a restart and can't corrupt the config on a crash.
- **Clear, differentiated failure** — a `400 invalid_grant` surfaces as `RefreshTokenInvalidError` ("re-link your account"), while rejected developer credentials (`401` / `invalid_client`) surface as a `ConfigurationError` ("check your API key/secret"). The raw token-endpoint response body is never logged.
