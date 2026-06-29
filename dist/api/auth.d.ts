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
import type { PluginLogger, TokenResponse } from '../types';
/** Minimal logger surface; any subset of methods may be provided. */
export type AuthLogger = PluginLogger;
export interface TokenManagerOptions {
    consumerKey: string;
    consumerSecret: string;
    refreshToken: string;
    /** Optional starting access token (e.g. restored from config). */
    accessToken?: string;
    /** Invoked whenever the API rotates the refresh token, so it can be persisted. */
    onRefreshToken?: (newRefreshToken: string) => Promise<void> | void;
    logger?: AuthLogger;
    /** Injectable clock (ms epoch). Defaults to {@link Date.now}. */
    now?: () => number;
    /** Maximum refresh attempts on transient failures. */
    maxRefreshAttempts?: number;
    /**
     * Injectable token-endpoint requester (primarily for tests). Receives the
     * url-encoded form body and the Basic auth header value.
     */
    requestToken?: (formBody: string, basicAuth: string) => Promise<TokenResponse>;
}
export declare class TokenManager {
    private accessToken;
    private refreshToken;
    private expiresAt;
    private refreshInFlight;
    /**
     * True while a config-supplied access token (whose true expiry is unknown)
     * may still be used. Cleared the first time we refresh, after which the
     * normal proactive-expiry lifecycle takes over.
     */
    private accessTokenIsOptimistic;
    private readonly consumerKey;
    private readonly consumerSecret;
    private readonly onRefreshToken?;
    private readonly logger?;
    private readonly now;
    private readonly maxRefreshAttempts;
    private readonly requestToken;
    constructor(options: TokenManagerOptions);
    /**
     * Return a valid access token, refreshing proactively if the current token is
     * missing or within the refresh buffer of expiring. A config-supplied token is
     * used optimistically once. Concurrent callers share a single refresh.
     */
    getAccessToken(): Promise<string>;
    /** Force a refresh regardless of the current token's expiry. */
    forceRefresh(): Promise<string>;
    /** The current (possibly rotated) refresh token. */
    getRefreshToken(): string;
    private refresh;
    /**
     * Execute the refresh, retrying transient (network/timeout) failures with
     * exponential backoff. Auth/parse failures are surfaced immediately.
     */
    private performRefresh;
    private applyToken;
}
/** A token-endpoint requester (overridable in tests). */
export type RequestToken = (formBody: string, basicAuth: string) => Promise<TokenResponse>;
export interface AuthorizationCodeExchangeOptions {
    /** Developer-app API Key (`client_id`). */
    consumerKey: string;
    /** Developer-app API Secret. */
    consumerSecret: string;
    /** The one-time `code` returned to the redirect URI by the authorize step. */
    code: string;
    /** Must byte-for-byte match the redirect URI registered with the developer app. */
    redirectUri: string;
    /** Injectable token-endpoint requester (primarily for tests). */
    requestToken?: RequestToken;
}
/**
 * Build the browser authorize URL for the OAuth2 Authorization Code flow.
 *
 * The user opens this URL, signs in, and approves access; Resideo then redirects
 * to `redirectUri?code=...`. Used by the `get-tokens` helper script.
 */
export declare function buildAuthorizeUrl(consumerKey: string, redirectUri: string): string;
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
export declare function extractAuthorizationCode(input: string): string;
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
export declare function exchangeAuthorizationCode(options: AuthorizationCodeExchangeOptions): Promise<TokenResponse>;
//# sourceMappingURL=auth.d.ts.map