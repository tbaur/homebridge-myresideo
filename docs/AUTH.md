# Account Linking & Token Lifecycle

## Getting credentials

1. Sign in / register at <https://developer.honeywellhome.com/user>.
2. Create a new application; give it a name.
3. Set the **Callback (Redirect) URL** to the value the plugin's link flow provides.
4. Copy the generated **Consumer Key (API Key)** and **Consumer Secret (API Secret)** into the plugin settings.
5. Use the **Link Account** flow to authorize and obtain the initial `accessToken` / `refreshToken`.

> **The account-linking UI is on the roadmap (see [`ROADMAP.md`](ROADMAP.md)) and is not available yet.** Until then, you must obtain the initial `refreshToken` (and optionally `accessToken`) manually via the Authorization Code flow described in [`API.md`](API.md), then paste them into the plugin config.

## How the plugin manages tokens

Resideo issues short-lived access tokens (~30 minutes) alongside a rotating refresh token. The `TokenManager` (`src/api/auth.ts`) keeps authentication robust without manual intervention:

- **Optimistic startup** — a config-supplied `accessToken` (whose true expiry is unknown) is used once, then the plugin refreshes from the `refreshToken`. The `accessToken` is therefore optional.
- **Proactive refresh** — refreshes one minute before `expires_in` elapses, so an in-flight poll never races an expiry.
- **Single-flight** — concurrent callers share one refresh request.
- **Bounded + retried** — the refresh request has a timeout and retries transient network/timeout/5xx failures with backoff, so one blip doesn't fail a whole cycle.
- **Rotation persistence** — when Resideo returns a new `refresh_token`, it is written back to `config.json` atomically (temp file + rename) so it survives a restart and can't corrupt the config on a crash.
- **Clear, differentiated failure** — a `400 invalid_grant` surfaces as `RefreshTokenInvalidError` ("re-link your account"), while rejected developer credentials (`401` / `invalid_client`) surface as a `ConfigurationError` ("check your API key/secret"). The raw token-endpoint response body is never logged.
