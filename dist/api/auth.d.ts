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
 *   - refreshes proactively, a buffer before expiry, so polls never race expiry;
 *   - collapses concurrent refreshes into a single in-flight request;
 *   - surfaces a typed {@link RefreshTokenInvalidError} on `invalid_grant`;
 *   - persists the rotated refresh token via {@link TokenManagerOptions.onRefreshToken}.
 */
import type { TokenResponse } from '../types';
/** Minimal logger surface; any subset of methods may be provided. */
export interface AuthLogger {
    debug?: (message: string) => void;
    warn?: (message: string) => void;
    error?: (message: string) => void;
}
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
    private readonly consumerKey;
    private readonly consumerSecret;
    private readonly onRefreshToken?;
    private readonly logger?;
    private readonly now;
    private readonly requestToken;
    constructor(options: TokenManagerOptions);
    /**
     * Return a valid access token, refreshing proactively if the current token is
     * missing or within the refresh buffer of expiring. Concurrent callers share
     * a single refresh.
     */
    getAccessToken(): Promise<string>;
    /** Force a refresh regardless of the current token's expiry. */
    forceRefresh(): Promise<string>;
    /** The current (possibly rotated) refresh token. */
    getRefreshToken(): string;
    private refresh;
    private applyToken;
}
//# sourceMappingURL=auth.d.ts.map