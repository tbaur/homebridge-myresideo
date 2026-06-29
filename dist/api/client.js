"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview HTTP client for the Resideo / Honeywell Home API.
 *
 * Every API call requires BOTH an OAuth2 bearer token (Authorization header)
 * and the developer `apikey` query parameter. This client injects both,
 * enforces a timeout, retries transient failures with backoff, and performs a
 * single token-refresh-and-retry on 401.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResideoApiClient = void 0;
const node_buffer_1 = require("node:buffer");
const node_https_1 = require("node:https");
const errors_1 = require("../errors");
const settings_1 = require("../settings");
const backoff_1 = require("../utils/backoff");
class ResideoApiClient {
    tokenManager;
    apikey;
    timeoutMs;
    maxRetryAttempts;
    logger;
    transport;
    constructor(options) {
        this.tokenManager = options.tokenManager;
        this.apikey = options.apikey;
        this.timeoutMs = options.timeoutMs ?? settings_1.DEFAULT_REQUEST_TIMEOUT_MS;
        this.maxRetryAttempts = options.maxRetryAttempts ?? settings_1.MAX_API_RETRY_ATTEMPTS;
        this.logger = options.logger;
        this.transport = options.transport ?? defaultTransport;
    }
    /** GET all locations (with their embedded devices) for the authenticated user. */
    async getLocations() {
        const locations = await this.get(settings_1.LOCATIONS_URL, {});
        // The locations endpoint must return an array; anything else (an object,
        // null, an error envelope) would otherwise blow up when the caller iterates
        // it, so surface it as a typed, non-retryable parse error.
        if (!Array.isArray(locations)) {
            throw new errors_1.ApiParseError('Locations response was not an array; the API returned an unexpected payload.');
        }
        return locations;
    }
    /** GET a single water leak detector's current status. */
    async getWaterLeakDetector(deviceID, locationId) {
        const url = `${settings_1.DEVICES_URL}/${settings_1.WATER_LEAK_DETECTOR_TYPE}/${encodeURIComponent(deviceID)}`;
        return this.get(url, { locationId: String(locationId) });
    }
    /**
     * Perform an authenticated GET. Adds `apikey` plus any extra query params,
     * retries transient failures, and refreshes the token once on a 401.
     */
    async get(baseUrl, params) {
        const url = this.buildUrl(baseUrl, params);
        const raw = await this.requestWithRetry(url);
        return this.parseJson(raw, url);
    }
    buildUrl(baseUrl, params) {
        const url = new URL(baseUrl);
        url.searchParams.set('apikey', this.apikey);
        for (const [key, value] of Object.entries(params)) {
            url.searchParams.set(key, value);
        }
        return url.toString();
    }
    async requestWithRetry(url) {
        let lastError;
        let refreshedOnAuth = false;
        for (let attempt = 1; attempt <= this.maxRetryAttempts; attempt++) {
            // When the server sends a Retry-After on a 429, honor it instead of the
            // generic backoff for this iteration only.
            let waitMs;
            try {
                const accessToken = await this.tokenManager.getAccessToken();
                const raw = await this.transport(url, accessToken, this.timeoutMs);
                if (raw.status >= 200 && raw.status < 300) {
                    return raw;
                }
                const error = (0, errors_1.createApiError)(raw.status, `Request to ${redact(url)} failed (${raw.status})`);
                // One token refresh-and-retry on auth failure.
                if (error instanceof errors_1.AuthenticationError && !refreshedOnAuth) {
                    refreshedOnAuth = true;
                    this.logger?.debug?.('Received 401; forcing token refresh and retrying');
                    await this.tokenManager.forceRefresh();
                    continue;
                }
                if (!error.isRetryable) {
                    throw error;
                }
                if (error instanceof errors_1.RateLimitError) {
                    waitMs = parseRetryAfterMs(raw.headers?.['retry-after']);
                }
                lastError = error;
            }
            catch (err) {
                if (err instanceof errors_1.AuthenticationError) {
                    throw err;
                }
                const isRetryable = err instanceof errors_1.NetworkError || err instanceof errors_1.TimeoutError;
                if (!isRetryable) {
                    throw err;
                }
                lastError = err;
            }
            if (attempt < this.maxRetryAttempts) {
                await (0, backoff_1.delay)(waitMs ?? (0, backoff_1.backoffMs)(attempt));
            }
        }
        throw lastError instanceof Error ? lastError : new errors_1.NetworkError('Request failed after retries');
    }
    parseJson(raw, url) {
        try {
            return JSON.parse(raw.body);
        }
        catch (err) {
            throw new errors_1.ApiParseError(`Failed to parse response from ${redact(url)}`, { cause: err });
        }
    }
}
exports.ResideoApiClient = ResideoApiClient;
/**
 * Parse an HTTP `Retry-After` header into milliseconds. Supports the
 * delta-seconds and HTTP-date forms, clamps to a sane maximum, and returns
 * `undefined` when the header is absent or unparseable (callers fall back to
 * exponential backoff).
 */
function parseRetryAfterMs(header) {
    const value = Array.isArray(header) ? header[0] : header;
    if (!value) {
        return undefined;
    }
    const trimmed = value.trim();
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(seconds * 1000, settings_1.MAX_RETRY_AFTER_MS);
    }
    const dateMs = Date.parse(trimmed);
    if (!Number.isNaN(dateMs)) {
        const deltaMs = dateMs - Date.now();
        return Math.min(Math.max(deltaMs, 0), settings_1.MAX_RETRY_AFTER_MS);
    }
    return undefined;
}
/** Strip the apikey from a URL before logging. */
function redact(url) {
    try {
        const u = new URL(url);
        if (u.searchParams.has('apikey')) {
            u.searchParams.set('apikey', '***');
        }
        return u.toString();
    }
    catch {
        return url;
    }
}
/** Default transport using Node's native https with a timeout. */
function defaultTransport(url, accessToken, timeoutMs) {
    return new Promise((resolve, reject) => {
        const target = new URL(url);
        const req = (0, node_https_1.request)(target, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json',
            },
            timeout: timeoutMs,
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
                    reject(new errors_1.NetworkError(`Response body exceeded the ${settings_1.MAX_RESPONSE_BODY_BYTES}-byte limit`));
                    return;
                }
                chunks.push(buf);
            });
            res.on('end', () => resolve({
                status: res.statusCode ?? 0,
                body: node_buffer_1.Buffer.concat(chunks).toString('utf8'),
                headers: res.headers,
            }));
        });
        req.on('timeout', () => {
            req.destroy();
            reject(new errors_1.TimeoutError(`Request timed out after ${timeoutMs}ms`));
        });
        req.on('error', err => reject(new errors_1.NetworkError(`Request failed: ${err.message}`, { cause: err })));
        req.end();
    });
}
//# sourceMappingURL=client.js.map