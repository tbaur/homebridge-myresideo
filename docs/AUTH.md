# Account Linking & Token Lifecycle

## Getting credentials

1. Sign in / register at <https://developer.honeywellhome.com/user>.
2. Create a new application; give it a name.
3. Set the **Callback (Redirect) URL** to the value the plugin's link flow
   provides.
4. Copy the generated **Consumer Key (API Key)** and **Consumer Secret (API
   Secret)** into the plugin settings.
5. Use the **Link Account** flow to authorize and obtain the initial
   `accessToken` / `refreshToken`.

> The account-linking UI is on the roadmap (see [`ROADMAP.md`](ROADMAP.md)).
> Until then, tokens can be obtained manually following [`API.md`](API.md).

## How the plugin manages tokens

Resideo issues short-lived access tokens (~30 minutes) alongside a rotating
refresh token. The `TokenManager` (`src/api/auth.ts`) keeps authentication
robust without manual intervention:

- **Proactive refresh** — refreshes one minute before `expires_in` elapses, so
  an in-flight poll never races an expiry.
- **Single-flight** — concurrent callers share one refresh request.
- **Rotation persistence** — when Resideo returns a new `refresh_token`, it is
  written back to `config.json` so it survives a restart.
- **Clear failure** — a `400 invalid_grant` surfaces as `RefreshTokenInvalidError`
  with a log message telling the user to re-link, instead of silently looping.
