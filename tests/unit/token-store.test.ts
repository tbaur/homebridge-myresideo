/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Unit tests for the plugin-owned OAuth token store.
 */

const mockReadFileSync = jest.fn()
const mockRename = jest.fn()
const mockRm = jest.fn()
const mockOpen = jest.fn()
const mockHandleWriteFile = jest.fn()
const mockHandleSync = jest.fn()
const mockHandleClose = jest.fn()

jest.mock('node:fs', () => ({
  promises: {
    rename: mockRename,
    rm: mockRm,
    open: mockOpen,
  },
  readFileSync: mockReadFileSync,
}))

import {
  TOKEN_FILE_MODE,
  TOKEN_STORE_FILE_PREFIX,
  TOKEN_STORE_VERSION,
  TokenStore,
  resolveTokenStorePath,
  sanitizeInstanceName,
  tokenStoreFileName,
} from '../../src/api/token-store'
import type { PluginLogger } from '../../src/types'

const STORAGE_DIR = '/tmp/hb-storage'

function makeLogger(): PluginLogger {
  return {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }
}

function makeStore(overrides: {
  storageDir?: string
  instanceName?: string
  consumerKey?: string
  sourceRefreshToken?: string
  logger?: PluginLogger
  now?: () => number
} = {}): { store: TokenStore, logger: PluginLogger } {
  const logger = overrides.logger ?? makeLogger()
  return {
    store: new TokenStore({
      storageDir: 'storageDir' in overrides ? overrides.storageDir : STORAGE_DIR,
      instanceName: overrides.instanceName ?? 'MyResideo',
      consumerKey: overrides.consumerKey ?? 'key',
      sourceRefreshToken: overrides.sourceRefreshToken ?? 'refresh',
      logger,
      now: overrides.now ?? (() => 1_700_000_000_000),
    }),
    logger,
  }
}

function validRecord(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: TOKEN_STORE_VERSION,
    refreshToken: 'rotated',
    accessToken: 'access-stored',
    sourceRefreshToken: 'refresh',
    updatedAt: 1,
    ...overrides,
  })
}

beforeEach(() => {
  mockReadFileSync.mockReset().mockImplementation(() => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  })
  mockRename.mockReset().mockResolvedValue(undefined)
  mockRm.mockReset().mockResolvedValue(undefined)
  mockHandleWriteFile.mockReset().mockResolvedValue(undefined)
  mockHandleSync.mockReset().mockResolvedValue(undefined)
  mockHandleClose.mockReset().mockResolvedValue(undefined)
  mockOpen.mockReset().mockResolvedValue({
    writeFile: mockHandleWriteFile,
    sync: mockHandleSync,
    close: mockHandleClose,
  })
})

describe('token store filename', () => {
  it('keeps a simple instance name and hashes the consumer key', () => {
    const fileName = tokenStoreFileName('Kitchen', 'key')
    expect(fileName.startsWith(`${TOKEN_STORE_FILE_PREFIX}-Kitchen-`)).toBe(true)
    expect(fileName.endsWith('.json')).toBe(true)
    expect(fileName).not.toContain('key')
  })

  it('gives two API keys different files even when the name matches', () => {
    expect(tokenStoreFileName('MyResideo', 'key-a')).not.toBe(tokenStoreFileName('MyResideo', 'key-b'))
  })

  it('gives two instance names different files when the API key matches', () => {
    expect(tokenStoreFileName('Kitchen', 'key')).not.toBe(tokenStoreFileName('Garage', 'key'))
  })

  it('resolves under the storage directory', () => {
    const fileName = tokenStoreFileName('MyResideo', 'key')
    expect(resolveTokenStorePath(STORAGE_DIR, 'MyResideo', 'key')).toBe(`${STORAGE_DIR}/${fileName}`)
  })
})

describe('sanitizeInstanceName', () => {
  it('falls back when the name is missing or only separators', () => {
    expect(sanitizeInstanceName(undefined)).toBe('platform')
    expect(sanitizeInstanceName('')).toBe('platform')
    expect(sanitizeInstanceName('..')).toBe('platform')
  })

  it('strips path characters and leading dots', () => {
    expect(sanitizeInstanceName('../etc/passwd')).toBe('_etc_passwd')
    expect(sanitizeInstanceName('My Resideo')).toBe('My_Resideo')
  })

  it('caps the fragment so a long name cannot grow the path without bound', () => {
    expect(sanitizeInstanceName('n'.repeat(80))).toHaveLength(64)
  })
})

describe('TokenStore.load', () => {
  it('returns stored tokens when they belong to this config refresh token', () => {
    mockReadFileSync.mockReturnValue(validRecord())
    const { store } = makeStore()

    expect(store.load()).toEqual({
      refreshToken: 'rotated',
      accessToken: 'access-stored',
    })
    expect(mockReadFileSync).toHaveBeenCalledWith(
      resolveTokenStorePath(STORAGE_DIR, 'MyResideo', 'key'),
      'utf8',
    )
  })

  it('ignores a store from a previous account link', () => {
    mockReadFileSync.mockReturnValue(validRecord({ sourceRefreshToken: 'older-link' }))
    const { store, logger } = makeStore()

    expect(store.load()).toBeUndefined()
    expect(logger.debug).toHaveBeenCalledWith(
      'Ignoring plugin token store from a previous account link',
    )
  })

  it('ignores a missing or corrupt store', () => {
    expect(makeStore().store.load()).toBeUndefined()

    mockReadFileSync.mockReturnValue('{not-json')
    expect(makeStore().store.load()).toBeUndefined()

    mockReadFileSync.mockReturnValue(validRecord({ version: 2 }))
    expect(makeStore().store.load()).toBeUndefined()
  })

  it('does not read disk when Homebridge gave no storage directory', () => {
    const { store, logger } = makeStore({ storageDir: '' })

    expect(store.isEnabled).toBe(false)
    expect(store.load()).toBeUndefined()
    expect(mockReadFileSync).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('storage directory'))
  })
})

describe('TokenStore.save', () => {
  it('writes owner-only, fsyncs, and renames onto the token store path', async () => {
    const { store, logger } = makeStore()
    const destPath = resolveTokenStorePath(STORAGE_DIR, 'MyResideo', 'key')

    await store.save({ refreshToken: 'rotated-token', accessToken: 'access-new' })

    expect(mockOpen).toHaveBeenCalledTimes(1)
    const [tempPath, flags, mode] = mockOpen.mock.calls[0] as [string, string, number]
    expect(tempPath.startsWith(`${destPath}.`)).toBe(true)
    expect(tempPath.endsWith('.tmp')).toBe(true)
    expect(flags).toBe('w')
    expect(mode).toBe(TOKEN_FILE_MODE)
    expect(mode & 0o077).toBe(0)

    const [content] = mockHandleWriteFile.mock.calls[0] as [string, string]
    const written = JSON.parse(content) as {
      version: number
      refreshToken: string
      accessToken: string
      sourceRefreshToken: string
    }
    expect(written).toMatchObject({
      version: TOKEN_STORE_VERSION,
      refreshToken: 'rotated-token',
      accessToken: 'access-new',
      sourceRefreshToken: 'refresh',
    })
    expect(content).not.toContain('platforms')

    expect(mockHandleSync).toHaveBeenCalledTimes(1)
    expect(mockHandleClose).toHaveBeenCalledTimes(1)
    expect(mockRename).toHaveBeenCalledWith(tempPath, destPath)
    expect(mockRm).toHaveBeenCalledWith(tempPath, { force: true })
    expect(logger.debug).toHaveBeenCalledWith(
      'Persisted refresh and access tokens to the plugin token store',
    )
  })

  it('replaces via rename-aside when rename cannot overwrite', async () => {
    const eexist = Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
    mockRename.mockRejectedValueOnce(eexist).mockResolvedValue(undefined)
    const destPath = resolveTokenStorePath(STORAGE_DIR, 'MyResideo', 'key')

    await makeStore().store.save({ refreshToken: 'rotated-token', accessToken: 'access-new' })

    const [tempPath] = mockOpen.mock.calls[0] as [string]
    expect(mockRename).toHaveBeenNthCalledWith(1, tempPath, destPath)
    expect(mockRename.mock.calls[1][0]).toBe(destPath)
    expect(mockRename.mock.calls[1][1]).toMatch(/\.bak$/)
    expect(mockRename).toHaveBeenNthCalledWith(3, tempPath, destPath)
    expect(mockRm).toHaveBeenCalledWith(expect.stringMatching(/\.bak$/), { force: true })
  })

  it('restores the backup if promote fails after rename-aside', async () => {
    const eexist = Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
    mockRename
      .mockRejectedValueOnce(eexist)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('promote failed'))
      .mockResolvedValueOnce(undefined)
    const destPath = resolveTokenStorePath(STORAGE_DIR, 'MyResideo', 'key')
    const { store, logger } = makeStore()

    await expect(store.save({ refreshToken: 'rotated-token', accessToken: 'access-new' }))
      .resolves.toBeUndefined()

    const backupPath = mockRename.mock.calls[1][1] as string
    expect(mockRename).toHaveBeenNthCalledWith(4, backupPath, destPath)
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Could not persist tokens'))
    expect(mockRm).not.toHaveBeenCalledWith(backupPath, expect.anything())
  })

  it('does not throw when the write fails, and removes the temp file', async () => {
    mockHandleSync.mockRejectedValue(new Error('sync failed'))
    const { store, logger } = makeStore()

    await expect(store.save({ refreshToken: 'rotated-token', accessToken: 'access-new' }))
      .resolves.toBeUndefined()

    expect(mockHandleClose).toHaveBeenCalledTimes(1)
    expect(mockRename).not.toHaveBeenCalled()
    expect(mockRm).toHaveBeenCalledWith(mockOpen.mock.calls[0][0], { force: true })
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Could not persist tokens'))
  })

  it('does not write when persist is disabled', async () => {
    const { store, logger } = makeStore({ storageDir: undefined })

    await store.save({ refreshToken: 'rotated-token', accessToken: 'access-new' })

    expect(mockOpen).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('storage directory'))
  })
})
