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
 *   - refreshes proactively, a buffer before expiry, so polls never race expiry;
 *   - collapses concurrent refreshes into a single in-flight request;
 *   - surfaces a typed {@link RefreshTokenInvalidError} on `invalid_grant`;
 *   - persists the rotated refresh token via {@link TokenManagerOptions.onRefreshToken}.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenManager = void 0;
const node_buffer_1 = require("node:buffer");
const node_https_1 = require("node:https");
const errors_1 = require("../errors");
const settings_1 = require("../settings");
class TokenManager {
    accessToken;
    refreshToken;
    expiresAt = 0;
    refreshInFlight = null;
    consumerKey;
    consumerSecret;
    onRefreshToken;
    logger;
    now;
    requestToken;
    constructor(options) {
        this.consumerKey = options.consumerKey;
        this.consumerSecret = options.consumerSecret;
        this.refreshToken = options.refreshToken;
        this.accessToken = options.accessToken ?? null;
        this.onRefreshToken = options.onRefreshToken;
        this.logger = options.logger;
        this.now = options.now ?? Date.now;
        this.requestToken = options.requestToken ?? defaultRequestToken;
    }
    /**
     * Return a valid access token, refreshing proactively if the current token is
     * missing or within the refresh buffer of expiring. Concurrent callers share
     * a single refresh.
     */
    async getAccessToken() {
        if (this.accessToken && this.now() < this.expiresAt) {
            return this.accessToken;
        }
        return this.refresh();
    }
    /** Force a refresh regardless of the current token's expiry. */
    async forceRefresh() {
        this.expiresAt = 0;
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
        const basicAuth = node_buffer_1.Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');
        const formBody = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: this.refreshToken,
        }).toString();
        this.refreshInFlight = this.requestToken(formBody, basicAuth)
            .then(async (token) => {
            this.applyToken(token);
            if (token.refresh_token && token.refresh_token !== this.refreshToken) {
                this.refreshToken = token.refresh_token;
                await this.onRefreshToken?.(token.refresh_token);
                this.logger?.debug?.('Refresh token rotated and persisted');
            }
            return this.accessToken;
        })
            .finally(() => {
            this.refreshInFlight = null;
        });
        return this.refreshInFlight;
    }
    applyToken(token) {
        const ttlSec = Number(token.expires_in) || settings_1.DEFAULT_TOKEN_TTL_SEC;
        this.accessToken = token.access_token;
        this.expiresAt = this.now() + ttlSec * 1000 - settings_1.TOKEN_REFRESH_BUFFER_MS;
    }
}
exports.TokenManager = TokenManager;
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
        }, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(node_buffer_1.Buffer.isBuffer(chunk) ? chunk : node_buffer_1.Buffer.from(chunk)));
            res.on('end', () => {
                const raw = node_buffer_1.Buffer.concat(chunks).toString('utf8');
                const status = res.statusCode ?? 0;
                if (status === 400 || status === 401) {
                    reject(new errors_1.RefreshTokenInvalidError(`Token refresh rejected (${status}): ${raw}`));
                    return;
                }
                if (status >= 400) {
                    reject(new errors_1.NetworkError(`Token endpoint returned status ${status}`));
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
        req.on('error', err => reject(new errors_1.NetworkError(`Token request failed: ${err.message}`, { cause: err })));
        req.write(formBody);
        req.end();
    });
}
//# sourceMappingURL=auth.js.map