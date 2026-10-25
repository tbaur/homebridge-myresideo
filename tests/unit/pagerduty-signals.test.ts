/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview The copied signal-store writer, against a real SQLite file.
 */

import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type * as Sqlite from 'node:sqlite'

import { PagerDutySignals } from '../../src/pagerduty-signals'
import { PLUGIN_NAME } from '../../src/settings'

const sqlite = typeof process.getBuiltinModule === 'function'
  ? process.getBuiltinModule('node:sqlite') as typeof Sqlite | undefined
  : undefined
const describeWithSqlite = sqlite ? describe : describe.skip

interface SignalRow {
  plugin: string
  signal: string
  active: number
  severity: string
  summary: string
  updated_at: number
}

describeWithSqlite('PagerDutySignals', () => {
  let storagePath: string
  let warn: jest.Mock
  let signals: PagerDutySignals

  const storeDir = (): string => join(storagePath, 'homebridge-pagerduty')
  const interfaceDir = (): string => join(storeDir(), 'signals-2026-10-24')
  const storeFile = (): string => join(interfaceDir(), 'signals.sqlite')

  const readRows = (): SignalRow[] => {
    const db = new sqlite!.DatabaseSync(storeFile())
    try {
      return db.prepare('SELECT * FROM signals ORDER BY signal').all() as unknown as SignalRow[]
    } finally {
      db.close()
    }
  }

  beforeEach(() => {
    storagePath = mkdtempSync(join(tmpdir(), 'myresideo-signals-'))
    warn = jest.fn()
    signals = new PagerDutySignals({ plugin: PLUGIN_NAME, storagePath, log: { warn } })
  })

  afterEach(() => {
    signals.close()
    rmSync(storagePath, { recursive: true, force: true })
  })

  it('creates both store directories with mode 0700 and the file with mode 0600', () => {
    signals.write('leak', {
      active: false,
      severity: 'critical',
      summary: 'A water leak detector is wet.',
    })

    expect(statSync(storeDir()).mode & 0o777).toBe(0o700)
    expect(statSync(interfaceDir()).mode & 0o777).toBe(0o700)
    expect(statSync(storeFile()).mode & 0o777).toBe(0o600)
  })

  it('writes a row that a separate connection reads back', () => {
    signals.write('auth-failed', {
      active: true,
      severity: 'error',
      summary: 'Resideo rejected the account link.',
    })

    expect(readRows()).toEqual([
      expect.objectContaining({
        plugin: PLUGIN_NAME,
        signal: 'auth-failed',
        active: 1,
        severity: 'error',
        summary: 'Resideo rejected the account link.',
      }),
    ])
  })

  it('does not rewrite a signal whose state has not changed', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000)
    signals.write('cloud-offline', {
      active: true,
      severity: 'error',
      summary: 'Homebridge has not reached Resideo.',
    })
    nowSpy.mockReturnValue(2_000)
    signals.write('cloud-offline', {
      active: true,
      severity: 'error',
      summary: 'Homebridge has not reached Resideo.',
    })
    nowSpy.mockRestore()

    expect(readRows()[0]?.updated_at).toBe(1_000)
  })

  it('stores a newline in a summary as a space', () => {
    signals.write('leak', {
      active: true,
      severity: 'critical',
      summary: 'A water leak detector\nis wet.',
    })

    expect(readRows()[0]?.summary).toBe('A water leak detector is wet.')
  })

  it('leaves the row in place when the connection closes', () => {
    signals.write('leak', {
      active: true,
      severity: 'critical',
      summary: 'A water leak detector is wet.',
    })
    signals.close()

    expect(readRows()).toEqual([
      expect.objectContaining({ signal: 'leak', active: 1 }),
    ])
  })

  it('creates nothing and warns once when node:sqlite is unavailable', () => {
    const spy = jest.spyOn(process, 'getBuiltinModule').mockReturnValue(undefined)
    try {
      signals.write('cloud-offline', {
        active: true,
        severity: 'error',
        summary: 'Homebridge has not reached Resideo.',
      })
      signals.write('auth-failed', {
        active: true,
        severity: 'error',
        summary: 'Resideo rejected the account link.',
      })
    } finally {
      spy.mockRestore()
    }

    expect(existsSync(storeDir())).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Node 22.13'))
  })

  it('warns once when the store directory cannot be created, and tries again later', () => {
    const broken = new PagerDutySignals({
      plugin: PLUGIN_NAME,
      storagePath: '/dev/null/myresideo-signals',
      log: { warn },
    })
    broken.write('leak', {
      active: true,
      severity: 'critical',
      summary: 'A water leak detector is wet.',
    })
    broken.write('leak', {
      active: false,
      severity: 'critical',
      summary: 'A water leak detector is wet.',
    })

    expect(warn).toHaveBeenCalledTimes(1)
    expect(existsSync(storeDir())).toBe(false)
    broken.close()
  })
})
