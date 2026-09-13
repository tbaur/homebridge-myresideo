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

import { createHash } from 'node:crypto'
import { promises as fs, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { PluginLogger } from '../types'
import { sanitizeError } from '../utils/sanitizers'

/** Owner-only mode: the file holds the live refresh and access tokens. */
export const TOKEN_FILE_MODE = 0o600

export const TOKEN_STORE_VERSION = 1

export const TOKEN_STORE_FILE_PREFIX = '.homebridge-myresideo-tokens'

export interface StoredTokens {
  refreshToken: string
  accessToken: string
}

export interface TokenStoreRecord extends StoredTokens {
  version: typeof TOKEN_STORE_VERSION
  /**
   * The `config.json` refresh token at the time this record was written.
   * Used to detect a re-link: a new Config UI save must win over a stale store.
   */
  sourceRefreshToken: string
  updatedAt: number
}

export interface TokenStoreOptions {
  /** Absolute Homebridge storage directory. Persist is disabled when omitted. */
  storageDir?: string
  /** Platform instance `name`; sanitized into the filename. */
  instanceName?: string
  consumerKey: string
  /** Config refresh token used to decide whether a stored record still applies. */
  sourceRefreshToken: string
  logger?: PluginLogger
  now?: () => number
}

/**
 * Turn a platform `name` into a filename fragment.
 *
 * Rejects path separators and leading dots so a crafted name cannot escape the
 * storage directory. Empty or stripped names fall back to `platform`.
 */
export function sanitizeInstanceName(name: string | undefined): string {
  if (!name) {
    return 'platform'
  }
  const safe = name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 64)
  return safe || 'platform'
}

/**
 * Filename for one platform instance.
 *
 * The consumer-key hash keeps two instances that share a display name but use
 * different Resideo apps from writing the same file. Two instances that share
 * both the name and the API key still collide — give each block a unique `name`.
 */
export function tokenStoreFileName(instanceName: string | undefined, consumerKey: string): string {
  const namePart = sanitizeInstanceName(instanceName)
  const keyPart = createHash('sha256').update(consumerKey).digest('hex').slice(0, 8)
  return `${TOKEN_STORE_FILE_PREFIX}-${namePart}-${keyPart}.json`
}

/** Absolute path of the token store under Homebridge storage. */
export function resolveTokenStorePath(
  storageDir: string,
  instanceName: string | undefined,
  consumerKey: string,
): string {
  return join(storageDir, tokenStoreFileName(instanceName, consumerKey))
}

export class TokenStore {
  private readonly filePath: string | undefined
  private readonly sourceRefreshToken: string
  private readonly logger: PluginLogger
  private readonly now: () => number

  constructor(options: TokenStoreOptions) {
    this.sourceRefreshToken = options.sourceRefreshToken
    this.logger = options.logger ?? {}
    this.now = options.now ?? Date.now
    this.filePath = resolveStorePath(options.storageDir, options.instanceName, options.consumerKey)
    if (!this.filePath) {
      this.logger.warn?.(
        'Homebridge did not provide a storage directory, so rotated tokens will not persist '
        + 'across restarts. Tokens still work for this session.',
      )
    }
  }

  get isEnabled(): boolean {
    return this.filePath !== undefined
  }

  /**
   * Load tokens from the store when they belong to this config refresh token.
   *
   * A missing, corrupt, or re-linked record is ignored so startup falls back
   * to the tokens in `config.json`.
   */
  load(): StoredTokens | undefined {
    const record = this.readRecord()
    if (!record) {
      return undefined
    }
    if (record.sourceRefreshToken !== this.sourceRefreshToken) {
      this.logger.debug?.('Ignoring plugin token store from a previous account link')
      return undefined
    }
    return { refreshToken: record.refreshToken, accessToken: record.accessToken }
  }

  /**
   * Persist the live tokens. Never throws: refresh already succeeded, and a
   * failed write must not fail the poll cycle.
   */
  async save(tokens: StoredTokens): Promise<void> {
    if (!this.filePath) {
      this.logger.error?.(
        'Could not persist tokens: Homebridge did not provide a storage directory. '
        + 'A future Homebridge restart may require re-linking your account.',
      )
      return
    }

    const record: TokenStoreRecord = {
      version: TOKEN_STORE_VERSION,
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      sourceRefreshToken: this.sourceRefreshToken,
      updatedAt: this.now(),
    }
    const tempPath = `${this.filePath}.${process.pid}.${this.now()}.tmp`
    try {
      await writeFileDurable(tempPath, `${JSON.stringify(record, null, 2)}\n`)
      await replaceFile(tempPath, this.filePath)
      this.logger.debug?.('Persisted refresh and access tokens to the plugin token store')
    } catch (err) {
      this.logger.error?.(
        `Could not persist tokens: ${sanitizeError(err)}. `
        + 'A future Homebridge restart may require re-linking your account.',
      )
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => undefined)
    }
  }

  private readRecord(): TokenStoreRecord | undefined {
    if (!this.filePath) {
      return undefined
    }
    try {
      return parseStoredRecord(readFileSync(this.filePath, 'utf8'))
    } catch {
      return undefined
    }
  }
}

function resolveStorePath(
  storageDir: string | undefined,
  instanceName: string | undefined,
  consumerKey: string,
): string | undefined {
  if (typeof storageDir !== 'string' || storageDir.length === 0) {
    return undefined
  }
  return resolveTokenStorePath(storageDir, instanceName, consumerKey)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseStoredRecord(raw: string): TokenStoreRecord | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!isRecord(parsed) || parsed.version !== TOKEN_STORE_VERSION) {
    return undefined
  }
  if (!isNonEmptyString(parsed.refreshToken) || !isNonEmptyString(parsed.sourceRefreshToken)) {
    return undefined
  }
  const accessToken = typeof parsed.accessToken === 'string' ? parsed.accessToken : ''
  const updatedAt = typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt)
    ? parsed.updatedAt
    : 0
  return {
    version: TOKEN_STORE_VERSION,
    refreshToken: parsed.refreshToken,
    accessToken,
    sourceRefreshToken: parsed.sourceRefreshToken,
    updatedAt,
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * Write and fsync before returning so a follow-up rename cannot publish a
 * still-cached, truncated token file.
 */
async function writeFileDurable(path: string, contents: string): Promise<void> {
  const handle = await fs.open(path, 'w', TOKEN_FILE_MODE)
  try {
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/**
 * Replace `destPath` with `tempPath`. Prefer a direct rename. When the
 * platform refuses to overwrite (typical on Windows), move the live file
 * aside, promote the temp file, and restore the backup if promote fails.
 */
async function replaceFile(tempPath: string, destPath: string): Promise<void> {
  try {
    await fs.rename(tempPath, destPath)
    return
  } catch (renameErr) {
    const code = (renameErr as NodeJS.ErrnoException).code
    if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'EACCES') {
      throw renameErr
    }
  }
  await replaceFileWindows(tempPath, destPath)
}

async function replaceFileWindows(tempPath: string, destPath: string): Promise<void> {
  const backupPath = `${destPath}.${process.pid}.${Date.now()}.bak`
  await fs.rename(destPath, backupPath)
  try {
    await fs.rename(tempPath, destPath)
  } catch (promoteErr) {
    await restoreBackup(backupPath, destPath, promoteErr)
    throw promoteErr
  }
  await fs.rm(backupPath, { force: true })
}

async function restoreBackup(backupPath: string, livePath: string, promoteErr: unknown): Promise<void> {
  try {
    await fs.rename(backupPath, livePath)
  } catch (restoreErr) {
    throw new Error(
      `Failed to promote the token store and restore the backup: ${sanitizeError(promoteErr)}; `
      + `restore: ${sanitizeError(restoreErr)}`,
    )
  }
}
