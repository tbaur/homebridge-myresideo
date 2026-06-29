"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview OAuth2 token manager for the Resideo / Honeywell Home API.
 *
 * Resideo issues short-lived access tokens (~30 min) alongside a rotating
 * refresh token. This manager:
 *   - uses a config-supplied access token optimistically once, then refreshes;
 *   - refreshes proactively, a buffer before expiry, so polls never race expiry;
 *   - collapses concurrent refreshes into a single in-flight request;
 *   - retries transient (network/timeout) refresh failures with backoff;
 *   - distinguishes an invalid refresh token from rejected API credentials;
 *   - persists the rotated refresh token via {@link TokenManagerOptions.onRefreshToken}.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenManager = void 0;
exports.buildAuthorizeUrl = buildAuthorizeUrl;
exports.extractAuthorizationCode = extractAuthorizationCode;
exports.exchangeAuthorizationCode = exchangeAuthorizationCode;
const node_buffer_1 = require("node:buffer");
const node_https_1 = require("node:https");
const errors_1 = require("../errors");
const settings_1 = require("../settings");
const backoff_1 = require("../utils/backoff");
class TokenManager {
    accessToken;
    refreshToken;
    expiresAt = 0;
    refreshInFlight = null;
    /**
     * True while a config-supplied access token (whose true expiry is unknown)
     * may still be used. Cleared the first time we refresh, after which the
     * normal proactive-expiry lifecycle takes over.
     */
    accessTokenIsOptimistic;
    consumerKey;
    consumerSecret;
    onRefreshToken;
    logger;
    now;
    maxRefreshAttempts;
    requestToken;
    constructor(options) {
        this.consumerKey = options.consumerKey;
        this.consumerSecret = options.consumerSecret;
        this.refreshToken = options.refreshToken;
        this.accessToken = options.accessToken ?? null;
        this.accessTokenIsOptimistic = Boolean(options.accessToken);
        this.onRefreshToken = options.onRefreshToken;
        this.logger = options.logger;
        this.now = options.now ?? Date.now;
        this.maxRefreshAttempts = options.maxRefreshAttempts ?? settings_1.MAX_TOKEN_REFRESH_ATTEMPTS;
        this.requestToken = options.requestToken ?? defaultRequestToken;
    }
    /**
     * Return a valid access token, refreshing proactively if the current token is
     * missing or within the refresh buffer of expiring. A config-supplied token is
     * used optimistically once. Concurrent callers share a single refresh.
     */
    async getAccessToken() {
        if (this.accessToken && this.now() < this.expiresAt) {
            return this.accessToken;
        }
        // A config-supplied token (unknown expiry) is used exactly once; thereafter
        // the normal proactive-expiry lifecycle drives refreshes.
        if (this.accessToken && this.accessTokenIsOptimistic) {
            this.accessTokenIsOptimistic = false;
            return this.accessToken;
        }
        return this.refresh();
    }
    /** Force a refresh regardless of the current token's expiry. */
    async forceRefresh() {
        this.expiresAt = 0;
        this.accessTokenIsOptimistic = false;
        return this.refresh();
    }
    /** The current (possibly rotated) refresh token. */
    getRefreshToken() {
        return this.refreshToken;
    }
    refresh() {
        if (this.refreshInFlight) {
            return this.refreshInFlight;
        }
        // Any refresh supersedes the optimistic config token.
        this.accessTokenIsOptimistic = false;
        const basicAuth = node_buffer_1.Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');
        const formBody = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: this.refreshToken,
        }).toString();
        this.refreshInFlight = this.performRefresh(formBody, basicAuth)
            .finally(() => {
            this.refreshInFlight = null;
        });
        return this.refreshInFlight;
    }
    /**
     * Execute the refresh, retrying transient (network/timeout) failures with
     * exponential backoff. Auth/parse failures are surfaced immediately.
     */
    async performRefresh(formBody, basicAuth) {
        let lastError;
        for (let attempt = 1; attempt <= this.maxRefreshAttempts; attempt++) {
            try {
                const token = await this.requestToken(formBody, basicAuth);
                this.applyToken(token);
                if (token.refresh_token && token.refresh_token !== this.refreshToken) {
                    this.refreshToken = token.refresh_token;
                    await this.onRefreshToken?.(token.refresh_token);
                    this.logger?.debug?.('Refresh token rotated and persisted');
                }
                return this.accessToken;
            }
            catch (err) {
                const isRetryable = err instanceof errors_1.NetworkError || err instanceof errors_1.TimeoutError;
                if (!isRetryable || attempt === this.maxRefreshAttempts) {
                    throw err;
                }
                lastError = err;
                this.logger?.debug?.(`Token refresh attempt ${attempt} failed (retryable); backing off`);
                await (0, backoff_1.delay)((0, backoff_1.backoffMs)(attempt));
            }
        }
        throw lastError instanceof Error ? lastError : new errors_1.NetworkError('Token refresh failed');
    }
    applyToken(token) {
        if (typeof token.access_token !== 'string' || token.access_token.length === 0) {
            throw new errors_1.ApiParseError('Token response did not include a usable access_token');
        }
        const ttlSec = Number(token.expires_in) || settings_1.DEFAULT_TOKEN_TTL_SEC;
        // Floor the usable lifetime so a pathologically short TTL (≤ the refresh
        // buffer) can't make a brand-new token look already-expired and stampede
        // the auth endpoint on every getAccessToken call.
        const lifetimeMs = Math.max(ttlSec * 1000 - settings_1.TOKEN_REFRESH_BUFFER_MS, settings_1.MIN_TOKEN_LIFETIME_MS);
        this.accessToken = token.access_token;
        this.expiresAt = this.now() + lifetimeMs;
    }
}
exports.TokenManager = TokenManager;
/**
 * Build the browser authorize URL for the OAuth2 Authorization Code flow.
 *
 * The user opens this URL, signs in, and approves access; Resideo then redirects
 * to `redirectUri?code=...`. Used by the `get-tokens` helper script.
 */
function buildAuthorizeUrl(consumerKey, redirectUri) {
    if (!consumerKey) {
        throw new errors_1.ValidationError('consumerKey is required to build the authorize URL');
    }
    if (!redirectUri) {
        throw new errors_1.ValidationError('redirectUri is required to build the authorize URL');
    }
    const url = new URL(settings_1.AUTHORIZE_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', consumerKey);
    url.searchParams.set('redirect_uri', redirectUri);
    return url.toString();
}
/**
 * Pull the one-time authorization `code` out of whatever the user pastes back
 * after approving access in the browser. Accepts either the bare `code` or the
 * full redirect URL (e.g. `http://localhost:8581/oauth/callback?code=...&...`),
 * so the account-linking UI can be forgiving about exactly what is pasted.
 *
 * Throws a {@link ValidationError} when no usable code is present, or when the
 * URL carries an OAuth `error` instead of a code. The pasted value (which may
 * contain a code) is never echoed back in the thrown message.
 */
function extractAuthorizationCode(input) {
    const trimmed = typeof input === 'string' ? input.trim() : '';
    if (!trimmed) {
        throw new errors_1.ValidationError('Paste the authorization code, or the full redirect URL, to finish linking.');
    }
    if (/^https?:\/\//i.test(trimmed)) {
        let parsed;
        try {
            parsed = new URL(trimmed);
        }
        catch {
            throw new errors_1.ValidationError('The pasted redirect URL is not a valid URL.');
        }
        const oauthError = parsed.searchParams.get('error');
        if (oauthError) {
            throw new errors_1.ValidationError(`Authorization was denied or failed (${oauthError}). Try linking again.`);
        }
        const code = parsed.searchParams.get('code');
        if (!code) {
            throw new errors_1.ValidationError('The pasted redirect URL did not contain an authorization code.');
        }
        return code;
    }
    // A bare value: reject anything with embedded whitespace, which means the
    // user pasted surrounding text rather than just the code.
    if (/\s/.test(trimmed)) {
        throw new errors_1.ValidationError('The authorization code should be a single value with no spaces.');
    }
    return trimmed;
}
/**
 * Exchange a one-time authorization `code` for the initial access/refresh token
 * pair (the `grant_type=authorization_code` leg of the OAuth2 flow). This is the
 * tested core of the `get-tokens` helper; the returned `refresh_token` is what a
 * user pastes into the plugin config.
 *
 * Error mapping (invalid_grant, invalid_client, etc.) is shared with token
 * refresh via {@link defaultRequestToken}, so failures surface as the same typed
 * errors and the raw response body is never logged.
 */
async function exchangeAuthorizationCode(options) {
    const { consumerKey, consumerSecret, code, redirectUri } = options;
    if (!consumerKey || !consumerSecret) {
        throw new errors_1.ValidationError('consumerKey and consumerSecret are required');
    }
    if (!code) {
        throw new errors_1.ValidationError('Authorization code is required');
    }
    if (!redirectUri) {
        throw new errors_1.ValidationError('redirectUri is required');
    }
    const requestToken = options.requestToken ?? defaultRequestToken;
    const basicAuth = node_buffer_1.Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
    const formBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
    }).toString();
    return requestToken(formBody, basicAuth);
}
/**
 * Default token-endpoint requester using Node's native https. POSTs a
 * url-encoded form with a Basic auth header, per the Honeywell Home OAuth2 spec.
 */
function defaultRequestToken(formBody, basicAuth) {
    return new Promise((resolve, reject) => {
        const url = new URL(settings_1.TOKEN_URL);
        const req = (0, node_https_1.request)(url, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${basicAuth}`,
                'Accept': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': String(node_buffer_1.Buffer.byteLength(formBody)),
            },
            timeout: settings_1.DEFAULT_REQUEST_TIMEOUT_MS,
        }, (res) => {
            const chunks = [];
            let total = 0;
            res.on('data', (chunk) => {
                const buf = node_buffer_1.Buffer.isBuffer(chunk) ? chunk : node_buffer_1.Buffer.from(chunk);
                total += buf.length;
                if (total > settings_1.MAX_RESPONSE_BODY_BYTES) {
                    // Tear down the response stream as well as the request so the
                    // underlying socket is released immediately instead of lingering.
                    res.destroy();
                    req.destroy();
                    reject(new errors_1.NetworkError(`Token response body exceeded the ${settings_1.MAX_RESPONSE_BODY_BYTES}-byte limit`));
                    return;
                }
                chunks.push(buf);
            });
            res.on('end', () => {
                const raw = node_buffer_1.Buffer.concat(chunks).toString('utf8');
                const status = res.statusCode ?? 0;
                if (status >= 400) {
                    reject(mapTokenError(status, raw));
                    return;
                }
                try {
                    resolve(JSON.parse(raw));
                }
                catch (err) {
                    reject(new errors_1.ApiParseError('Failed to parse token response', { cause: err }));
                }
            });
        });
        req.on('timeout', () => {
            req.destroy();
            reject(new errors_1.TimeoutError(`Token request timed out after ${settings_1.DEFAULT_REQUEST_TIMEOUT_MS}ms`));
        });
        req.on('error', err => reject(new errors_1.NetworkError(`Token request failed: ${err.message}`, { cause: err })));
        req.write(formBody);
        req.end();
    });
}
/**
 * Map a non-2xx token-endpoint response to a typed error. Distinguishes an
 * expired/invalid refresh token (user must re-link) from rejected developer
 * credentials (user must fix the API key/secret). The raw response body is NOT
 * embedded, to avoid leaking token material into logs.
 */
function mapTokenError(status, rawBody) {
    const oauthError = parseOAuthError(rawBody);
    if (oauthError === 'invalid_grant') {
        return new errors_1.RefreshTokenInvalidError();
    }
    if (status === 401 || oauthError === 'invalid_client' || oauthError === 'unauthorized_client') {
        return new errors_1.ConfigurationError('Resideo rejected the API credentials. Verify the Consumer Key and Secret in the plugin settings.');
    }
    if (status >= 500) {
        return new errors_1.NetworkError(`Token endpoint returned status ${status}`);
    }
    // Any other 4xx: treat as a re-link condition rather than guessing.
    return new errors_1.RefreshTokenInvalidError(`Token refresh was rejected (HTTP ${status}); re-link your account in the plugin settings.`);
}
/** Best-effort extraction of the OAuth2 `error` code from a response body. */
function parseOAuthError(rawBody) {
    try {
        const parsed = JSON.parse(rawBody);
        return typeof parsed.error === 'string' ? parsed.error : undefined;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=auth.js.map