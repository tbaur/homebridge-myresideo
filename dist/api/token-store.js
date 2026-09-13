"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenStore = exports.TOKEN_STORE_FILE_PREFIX = exports.TOKEN_STORE_VERSION = exports.TOKEN_FILE_MODE = void 0;
exports.sanitizeInstanceName = sanitizeInstanceName;
exports.tokenStoreFileName = tokenStoreFileName;
exports.resolveTokenStorePath = resolveTokenStorePath;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const sanitizers_1 = require("../utils/sanitizers");
/** Owner-only mode: the file holds the live refresh and access tokens. */
exports.TOKEN_FILE_MODE = 0o600;
exports.TOKEN_STORE_VERSION = 1;
exports.TOKEN_STORE_FILE_PREFIX = '.homebridge-myresideo-tokens';
/**
 * Turn a platform `name` into a filename fragment.
 *
 * Rejects path separators and leading dots so a crafted name cannot escape the
 * storage directory. Empty or stripped names fall back to `platform`.
 */
function sanitizeInstanceName(name) {
    if (!name) {
        return 'platform';
    }
    const safe = name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 64);
    return safe || 'platform';
}
/**
 * Filename for one platform instance.
 *
 * The consumer-key hash keeps two instances that share a display name but use
 * different Resideo apps from writing the same file. Two instances that share
 * both the name and the API key still collide — give each block a unique `name`.
 */
function tokenStoreFileName(instanceName, consumerKey) {
    const namePart = sanitizeInstanceName(instanceName);
    const keyPart = (0, node_crypto_1.createHash)('sha256').update(consumerKey).digest('hex').slice(0, 8);
    return `${exports.TOKEN_STORE_FILE_PREFIX}-${namePart}-${keyPart}.json`;
}
/** Absolute path of the token store under Homebridge storage. */
function resolveTokenStorePath(storageDir, instanceName, consumerKey) {
    return (0, node_path_1.join)(storageDir, tokenStoreFileName(instanceName, consumerKey));
}
class TokenStore {
    filePath;
    sourceRefreshToken;
    logger;
    now;
    constructor(options) {
        this.sourceRefreshToken = options.sourceRefreshToken;
        this.logger = options.logger ?? {};
        this.now = options.now ?? Date.now;
        this.filePath = resolveStorePath(options.storageDir, options.instanceName, options.consumerKey);
        if (!this.filePath) {
            this.logger.warn?.('Homebridge did not provide a storage directory, so rotated tokens will not persist '
                + 'across restarts. Tokens still work for this session.');
        }
    }
    get isEnabled() {
        return this.filePath !== undefined;
    }
    /**
     * Load tokens from the store when they belong to this config refresh token.
     *
     * A missing, corrupt, or re-linked record is ignored so startup falls back
     * to the tokens in `config.json`.
     */
    load() {
        const record = this.readRecord();
        if (!record) {
            return undefined;
        }
        if (record.sourceRefreshToken !== this.sourceRefreshToken) {
            this.logger.debug?.('Ignoring plugin token store from a previous account link');
            return undefined;
        }
        return { refreshToken: record.refreshToken, accessToken: record.accessToken };
    }
    /**
     * Persist the live tokens. Never throws: refresh already succeeded, and a
     * failed write must not fail the poll cycle.
     */
    async save(tokens) {
        if (!this.filePath) {
            this.logger.error?.('Could not persist tokens: Homebridge did not provide a storage directory. '
                + 'A future Homebridge restart may require re-linking your account.');
            return;
        }
        const record = {
            version: exports.TOKEN_STORE_VERSION,
            refreshToken: tokens.refreshToken,
            accessToken: tokens.accessToken,
            sourceRefreshToken: this.sourceRefreshToken,
            updatedAt: this.now(),
        };
        const tempPath = `${this.filePath}.${process.pid}.${this.now()}.tmp`;
        try {
            await writeFileDurable(tempPath, `${JSON.stringify(record, null, 2)}\n`);
            await replaceFile(tempPath, this.filePath);
            this.logger.debug?.('Persisted refresh and access tokens to the plugin token store');
        }
        catch (err) {
            this.logger.error?.(`Could not persist tokens: ${(0, sanitizers_1.sanitizeError)(err)}. `
                + 'A future Homebridge restart may require re-linking your account.');
        }
        finally {
            await node_fs_1.promises.rm(tempPath, { force: true }).catch(() => undefined);
        }
    }
    readRecord() {
        if (!this.filePath) {
            return undefined;
        }
        try {
            return parseStoredRecord((0, node_fs_1.readFileSync)(this.filePath, 'utf8'));
        }
        catch {
            return undefined;
        }
    }
}
exports.TokenStore = TokenStore;
function resolveStorePath(storageDir, instanceName, consumerKey) {
    if (typeof storageDir !== 'string' || storageDir.length === 0) {
        return undefined;
    }
    return resolveTokenStorePath(storageDir, instanceName, consumerKey);
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function parseStoredRecord(raw) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return undefined;
    }
    if (!isRecord(parsed) || parsed.version !== exports.TOKEN_STORE_VERSION) {
        return undefined;
    }
    if (!isNonEmptyString(parsed.refreshToken) || !isNonEmptyString(parsed.sourceRefreshToken)) {
        return undefined;
    }
    const accessToken = typeof parsed.accessToken === 'string' ? parsed.accessToken : '';
    const updatedAt = typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt)
        ? parsed.updatedAt
        : 0;
    return {
        version: exports.TOKEN_STORE_VERSION,
        refreshToken: parsed.refreshToken,
        accessToken,
        sourceRefreshToken: parsed.sourceRefreshToken,
        updatedAt,
    };
}
function isNonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
}
/**
 * Write and fsync before returning so a follow-up rename cannot publish a
 * still-cached, truncated token file.
 */
async function writeFileDurable(path, contents) {
    const handle = await node_fs_1.promises.open(path, 'w', exports.TOKEN_FILE_MODE);
    try {
        await handle.writeFile(contents, 'utf8');
        await handle.sync();
    }
    finally {
        await handle.close();
    }
}
/**
 * Replace `destPath` with `tempPath`. Prefer a direct rename. When the
 * platform refuses to overwrite (typical on Windows), move the live file
 * aside, promote the temp file, and restore the backup if promote fails.
 */
async function replaceFile(tempPath, destPath) {
    try {
        await node_fs_1.promises.rename(tempPath, destPath);
        return;
    }
    catch (renameErr) {
        const code = renameErr.code;
        if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'EACCES') {
            throw renameErr;
        }
    }
    await replaceFileWindows(tempPath, destPath);
}
async function replaceFileWindows(tempPath, destPath) {
    const backupPath = `${destPath}.${process.pid}.${Date.now()}.bak`;
    await node_fs_1.promises.rename(destPath, backupPath);
    try {
        await node_fs_1.promises.rename(tempPath, destPath);
    }
    catch (promoteErr) {
        await restoreBackup(backupPath, destPath, promoteErr);
        throw promoteErr;
    }
    await node_fs_1.promises.rm(backupPath, { force: true });
}
async function restoreBackup(backupPath, livePath, promoteErr) {
    try {
        await node_fs_1.promises.rename(backupPath, livePath);
    }
    catch (restoreErr) {
        throw new Error(`Failed to promote the token store and restore the backup: ${(0, sanitizers_1.sanitizeError)(promoteErr)}; `
            + `restore: ${(0, sanitizers_1.sanitizeError)(restoreErr)}`);
    }
}
//# sourceMappingURL=token-store.js.map