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
 * enforces a timeout, retries transient failures with backoff, performs a
 * single token-refresh-and-retry on 401, and gates requests through a circuit
 * breaker so sustained Resideo outages fail fast instead of hammering the API.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResideoApiClient = void 0;
const node_buffer_1 = require("node:buffer");
const node_https_1 = require("node:https");
const errors_1 = require("../errors");
const settings_1 = require("../settings");
const backoff_1 = require("../utils/backoff");
const circuit_breaker_1 = require("./circuit-breaker");
/**
 * Errors that should count against the circuit breaker: server-side and
 * connectivity problems. Client errors (4xx) reflect the request, not service
 * health, and must not trip the breaker.
 */
function isCircuitBreakerFailure(error) {
    if (error instanceof errors_1.NetworkError
        || error instanceof errors_1.TimeoutError
        || error instanceof errors_1.ApiParseError) {
        return true;
    }
    if (error instanceof errors_1.ApiResponseError) {
        return error.httpStatus >= 500 && error.httpStatus < 600;
    }
    return false;
}
class ResideoApiClient {
    tokenManager;
    apikey;
    timeoutMs;
    maxRetryAttempts;
    logger;
    transport;
    metrics;
    onRetry;
    onCircuitOpen;
    circuitBreaker;
    constructor(options) {
        this.tokenManager = options.tokenManager;
        this.apikey = options.apikey;
        this.timeoutMs = options.timeoutMs ?? settings_1.DEFAULT_REQUEST_TIMEOUT_MS;
        this.maxRetryAttempts = options.maxRetryAttempts ?? settings_1.MAX_API_RETRY_ATTEMPTS;
        this.logger = options.logger;
        this.transport = options.transport ?? defaultTransport;
        this.metrics = options.metrics;
        this.onRetry = options.onRetry;
        this.onCircuitOpen = options.onCircuitOpen;
        this.circuitBreaker = new circuit_breaker_1.CircuitBreaker({
            ...options.circuitBreaker,
            onStateChange: (from, to) => {
                options.circuitBreaker?.onStateChange?.(from, to);
                this.logCircuitTransition(from, to);
            },
        });
    }
    /** GET all locations (with their embedded devices) for the authenticated user. */
    async getLocations() {
        // Validate the array shape inside get()'s success path (before recordSuccess)
        // so a 200 non-array body counts as a breaker failure, not a success.
        return this.get(settings_1.LOCATIONS_URL, {}, (parsed) => {
            if (!Array.isArray(parsed)) {
                throw new errors_1.ApiParseError('Locations response was not an array; the API returned an unexpected payload.');
            }
            return parsed;
        });
    }
    /** GET a single water leak detector's current status. */
    async getWaterLeakDetector(deviceID, locationId) {
        const url = `${settings_1.DEVICES_URL}/${settings_1.WATER_LEAK_DETECTOR_TYPE}/${encodeURIComponent(deviceID)}`;
        return this.get(url, { locationId: String(locationId) });
    }
    /** Current resilience status (circuit breaker). */
    getStatus() {
        return {
            circuitBreaker: this.circuitBreaker.getStatus(),
        };
    }
    /** Reset the circuit breaker (primarily for tests). */
    resetCircuitBreaker() {
        this.circuitBreaker.reset();
    }
    /**
     * Perform an authenticated GET. Adds `apikey` plus any extra query params,
     * gates through the circuit breaker, retries transient failures, and refreshes
     * the token once on a 401.
     *
     * @param validate Optional post-parse check that runs before the attempt is
     *   counted as a breaker success. Thrown errors are treated as request failures.
     */
    async get(baseUrl, params, validate) {
        const url = this.buildUrl(baseUrl, params);
        // Gate once per logical request — never re-checked mid-retry — so a single
        // call cannot race the breaker open/closed across attempts.
        if (!this.circuitBreaker.canRequest()) {
            const status = this.circuitBreaker.getStatus();
            throw new errors_1.CircuitBreakerError(status.remainingResetTime ?? circuit_breaker_1.DEFAULT_CIRCUIT_BREAKER_CONFIG.resetTimeout);
        }
        if (this.circuitBreaker.state === circuit_breaker_1.CircuitState.HALF_OPEN) {
            this.circuitBreaker.trackHalfOpenRequest();
        }
        try {
            const { raw, durationMs } = await this.requestWithRetry(url);
            // Parse (and optional validate) after the transport succeeds so a 200 with
            // an unexpected body is counted as a breaker failure, not a success.
            try {
                const parsed = this.parseJson(raw, url);
                const value = validate ? validate(parsed) : parsed;
                this.metrics?.({ durationMs, ok: true });
                this.circuitBreaker.recordSuccess();
                return value;
            }
            catch (err) {
                this.metrics?.({ durationMs, ok: false });
                throw err;
            }
        }
        catch (error) {
            // A single failure is recorded per logical request after retries are
            // exhausted, so retries don't artificially accelerate the breaker.
            // While HALF_OPEN, ANY terminal outcome must release the probe slot
            // (via recordFailure -> OPEN). Otherwise an auth/4xx/429 probe failure
            // would leave halfOpenRequests capped and wedge the breaker forever,
            // suppressing later poll traffic and re-link signaling.
            if (this.circuitBreaker.state === circuit_breaker_1.CircuitState.HALF_OPEN
                || isCircuitBreakerFailure(error)) {
                this.circuitBreaker.recordFailure();
            }
            throw error;
        }
    }
    /**
     * Surface circuit-breaker transitions so operators can see when the Resideo
     * API is being treated as unavailable and when it recovers. OPEN is warn;
     * HALF_OPEN (probe) and CLOSED (recovery) are info.
     */
    logCircuitTransition(from, to) {
        const message = `Circuit breaker ${from} -> ${to}`;
        if (to === circuit_breaker_1.CircuitState.OPEN) {
            this.logger?.warn?.(message);
            this.onCircuitOpen?.();
        }
        else {
            this.logger?.info?.(message);
        }
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
                const { raw, durationMs } = await this.timedTransport(url, accessToken);
                if (raw.status >= 200 && raw.status < 300) {
                    return { raw, durationMs };
                }
                const error = (0, errors_1.createApiError)(raw.status, `API request failed: ${raw.status}`);
                // One token refresh-and-retry on auth failure. Decrement `attempt` so
                // the for-loop increment still grants a follow-up transport with the
                // fresh token even when the 401 arrived on the final attempt budget.
                if (error instanceof errors_1.AuthenticationError && !refreshedOnAuth) {
                    refreshedOnAuth = true;
                    this.logger?.debug?.('Received 401; forcing token refresh and retrying');
                    await this.tokenManager.forceRefresh();
                    this.onRetry?.();
                    attempt--;
                    continue;
                }
                if (!error.isRetryable) {
                    throw error;
                }
                if (error instanceof errors_1.RateLimitError) {
                    waitMs = (0, backoff_1.parseRetryAfterMs)(raw.headers?.['retry-after']);
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
                this.onRetry?.();
                await (0, backoff_1.delay)(waitMs ?? (0, backoff_1.backoffMs)(attempt));
            }
        }
        throw lastError instanceof Error ? lastError : new errors_1.NetworkError('Request failed after retries');
    }
    /**
     * Invoke the transport and time the attempt. A networked failure (a non-2xx
     * response, or a thrown network/timeout error) records an `ok: false` metric
     * here and is re-thrown/returned for the retry logic. A 2xx response does NOT
     * record here: its metric is deferred to {@link get} so the JSON parse outcome
     * is included, and the measured duration is returned to the caller.
     */
    async timedTransport(url, accessToken) {
        const startedAt = Date.now();
        try {
            const raw = await this.transport(url, accessToken, this.timeoutMs);
            const durationMs = Date.now() - startedAt;
            if (raw.status < 200 || raw.status >= 300) {
                this.metrics?.({ durationMs, ok: false });
            }
            return { raw, durationMs };
        }
        catch (err) {
            this.metrics?.({ durationMs: Date.now() - startedAt, ok: false });
            throw err;
        }
    }
    parseJson(raw, url) {
        try {
            return JSON.parse(raw.body);
        }
        catch (err) {
            throw new errors_1.ApiParseError(`Failed to parse response from ${describeUrl(url)}`, { cause: err });
        }
    }
}
exports.ResideoApiClient = ResideoApiClient;
/** Path-only URL description for error messages (never includes query/secrets). */
function describeUrl(url) {
    try {
        return new URL(url).pathname;
    }
    catch {
        return 'API';
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