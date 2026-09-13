/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Plugin-owned store for rotated OAuth tokens.
 *
 * Resideo refresh tokens are one-time. After a rotation the live token exists
 * only in memory unless we persist it. Sibling plugins keep that state in a
 * file under Homebridge storage. This module does the same: it never reads or
 * writes `config.json`, so a token refresh cannot rewrite every other
 * platform's settings or change that file's permissions.
 */
import type { PluginLogger } from '../types';
/** Owner-only mode: the file holds the live refresh and access tokens. */
export declare const TOKEN_FILE_MODE = 384;
export declare const TOKEN_STORE_VERSION = 1;
export declare const TOKEN_STORE_FILE_PREFIX = ".homebridge-myresideo-tokens";
export interface StoredTokens {
    refreshToken: string;
    accessToken: string;
}
export interface TokenStoreRecord extends StoredTokens {
    version: typeof TOKEN_STORE_VERSION;
    /**
     * The `config.json` refresh token at the time this record was written.
     * Used to detect a re-link: a new Config UI save must win over a stale store.
     */
    sourceRefreshToken: string;
    updatedAt: number;
}
export interface TokenStoreOptions {
    /** Absolute Homebridge storage directory. Persist is disabled when omitted. */
    storageDir?: string;
    /** Platform instance `name`; sanitized into the filename. */
    instanceName?: string;
    consumerKey: string;
    /** Config refresh token used to decide whether a stored record still applies. */
    sourceRefreshToken: string;
    logger?: PluginLogger;
    now?: () => number;
}
/**
 * Turn a platform `name` into a filename fragment.
 *
 * Rejects path separators and leading dots so a crafted name cannot escape the
 * storage directory. Empty or stripped names fall back to `platform`.
 */
export declare function sanitizeInstanceName(name: string | undefined): string;
/**
 * Filename for one platform instance.
 *
 * The consumer-key hash keeps two instances that share a display name but use
 * different Resideo apps from writing the same file. Two instances that share
 * both the name and the API key still collide — give each block a unique `name`.
 */
export declare function tokenStoreFileName(instanceName: string | undefined, consumerKey: string): string;
/** Absolute path of the token store under Homebridge storage. */
export declare function resolveTokenStorePath(storageDir: string, instanceName: string | undefined, consumerKey: string): string;
export declare class TokenStore {
    private readonly filePath;
    private readonly sourceRefreshToken;
    private readonly logger;
    private readonly now;
    constructor(options: TokenStoreOptions);
    get isEnabled(): boolean;
    /**
     * Load tokens from the store when they belong to this config refresh token.
     *
     * A missing, corrupt, or re-linked record is ignored so startup falls back
     * to the tokens in `config.json`.
     */
    load(): StoredTokens | undefined;
    /**
     * Persist the live tokens. Never throws: refresh already succeeded, and a
     * failed write must not fail the poll cycle.
     */
    save(tokens: StoredTokens): Promise<void>;
    private readRecord;
}
//# sourceMappingURL=token-store.d.ts.map