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
import type { PluginLogger, ResideoLocation, WaterLeakDetector } from '../types';
import type { TokenManager } from './auth';
/** Minimal logger surface; any subset of methods may be provided. */
export type ClientLogger = PluginLogger;
/** A raw HTTP response from the low-level transport. */
export interface RawResponse {
    status: number;
    body: string;
    /** Response headers (lower-cased keys), used to honor `Retry-After` on 429s. */
    headers?: Record<string, string | string[] | undefined>;
}
export interface ApiClientOptions {
    tokenManager: TokenManager;
    /** Developer API Key, sent as the required `apikey` query parameter. */
    apikey: string;
    timeoutMs?: number;
    maxRetryAttempts?: number;
    logger?: ClientLogger;
    /** Injectable transport (primarily for tests). */
    transport?: (url: string, accessToken: string, timeoutMs: number) => Promise<RawResponse>;
}
export declare class ResideoApiClient {
    private readonly tokenManager;
    private readonly apikey;
    private readonly timeoutMs;
    private readonly maxRetryAttempts;
    private readonly logger?;
    private readonly transport;
    constructor(options: ApiClientOptions);
    /** GET all locations (with their embedded devices) for the authenticated user. */
    getLocations(): Promise<ResideoLocation[]>;
    /** GET a single water leak detector's current status. */
    getWaterLeakDetector(deviceID: string, locationId: number | string): Promise<WaterLeakDetector>;
    /**
     * Perform an authenticated GET. Adds `apikey` plus any extra query params,
     * retries transient failures, and refreshes the token once on a 401.
     */
    get<T>(baseUrl: string, params: Record<string, string>): Promise<T>;
    private buildUrl;
    private requestWithRetry;
    private parseJson;
}
//# sourceMappingURL=client.d.ts.map