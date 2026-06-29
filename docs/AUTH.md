# Account Linking & Token Lifecycle

## Getting credentials

1. Sign in / register at <https://developer.honeywellhome.com/user>.
2. Create a new application; give it a name.
3. Set the **Callback (Redirect) URL** to a localhost URL you will use with the helper script below. The default the script expects is `http://localhost:8581/oauth/callback`; if you register a different value, pass it via `--redirect-uri`. It must match byte-for-byte.
4. Copy the generated **Consumer Key (API Key)** and **Consumer Secret (API Secret)**.
5. Link your account — either from the plugin settings UI (recommended) or with the `get-tokens` helper script (a command-line fallback). Both complete the same OAuth2 Authorization Code flow and end with a `refreshToken` (and `accessToken`) saved to your plugin config.

## Linking your account from the plugin settings (recommended)

The plugin ships a custom Homebridge settings UI that runs the Authorization Code flow for you. It is built on the same token-exchange code the plugin uses at runtime (`src/api/auth.ts`, unit tested), so nothing is sent anywhere except Resideo's token endpoint. In the Homebridge UI, open this plugin's settings and use the **Link your Resideo account** panel:

1. Enter your **Consumer Key** and **Consumer Secret**, and confirm the **Redirect URL**. It must match the Callback URL registered on your developer application byte-for-byte; the default `http://localhost:8581/oauth/callback` is fine for most setups, and nothing needs to be listening there.
2. Click **Open Resideo sign-in**. A new browser tab opens Resideo's sign-in page; sign in and approve access.
3. Resideo redirects that tab to your Redirect URL with a one-time `code` attached. Because nothing is listening at that address, the tab will usually show a browser error or a blank page — that is expected. Copy the entire address-bar URL (or just the `code` value from it).
4. Paste it into the **Paste the result** box and click **Link account**. The plugin exchanges the code for tokens, saves them to your config, and you restart Homebridge to apply.

Because the `code` travels inside the redirect URL itself, this flow works identically whether Homebridge runs on the machine you are browsing from or on a remote host — there is no extra port to open and nothing to expose.

## Obtaining tokens with the `get-tokens` helper (command-line fallback)

The repository ships a one-off script that runs the OAuth2 Authorization Code flow for you. It starts a temporary localhost server on your registered redirect URI, opens the Resideo authorize page in your browser, captures the returned `code`, exchanges it for tokens, and prints a ready-to-paste `credentials` block. The token exchange itself is the same code the plugin uses at runtime (`src/api/auth.ts`) and is covered by unit tests.

From a clone of this repository:

```bash
npm install            # also builds dist/ via the prepare script
npm run get-tokens     # prompts for your Consumer Key and Secret
```

Run with no flags and the script prompts for the Consumer Key and Secret interactively — the recommended approach, since it keeps your secret out of your shell history and process list. Alternatively, supply them via environment variables:

```bash
export RESIDEO_CONSUMER_KEY=<CONSUMER_KEY>
export RESIDEO_CONSUMER_SECRET=<CONSUMER_SECRET>
npm run get-tokens
```

Flags are also accepted (`--key`, `--secret`, `--redirect-uri`), but **avoid passing the secret as a flag on a shared host** — command-line arguments are visible to other local users via `ps`. If you registered a redirect URI other than the default, pass it explicitly (the redirect URI is not sensitive):

```bash
RESIDEO_CONSUMER_KEY=<CONSUMER_KEY> RESIDEO_CONSUMER_SECRET=<CONSUMER_SECRET> \
  npm run get-tokens -- --redirect-uri http://localhost:8581/oauth/callback
```

The redirect URI must point at `localhost` or `127.0.0.1` so the script can receive the redirect, and must match the value registered on your developer application exactly. The script prints your tokens to the terminal only — nothing is written to disk or sent anywhere except Resideo's token endpoint.

## How the plugin manages tokens

Resideo issues short-lived access tokens (~30 minutes) alongside a rotating refresh token. The `TokenManager` (`src/api/auth.ts`) keeps authentication robust without manual intervention:

- **Optimistic startup** — a config-supplied `accessToken` (whose true expiry is unknown) is used once, then the plugin refreshes from the `refreshToken`. The `accessToken` is therefore optional.
- **Proactive refresh** — refreshes one minute before `expires_in` elapses, so an in-flight poll never races an expiry.
- **Single-flight** — concurrent callers share one refresh request.
- **Bounded + retried** — the refresh request has a timeout and retries transient network/timeout/5xx failures with backoff, so one blip doesn't fail a whole cycle.
- **Rotation persistence** — when Resideo returns a new `refresh_token`, it is written back to `config.json` atomically (temp file + rename) so it survives a restart and can't corrupt the config on a crash.
- **Clear, differentiated failure** — a `400 invalid_grant` surfaces as `RefreshTokenInvalidError` ("re-link your account"), while rejected developer credentials (`401` / `invalid_client`) surface as a `ConfigurationError` ("check your API key/secret"). The raw token-endpoint response body is never logged.
