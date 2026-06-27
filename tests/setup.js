/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * Test setup file - runs before all tests.
 * Ensures a sandboxed environment so no real network calls can be made.
 */

if (process.env.NODE_ENV !== 'test') {
  throw new Error('Tests must run with NODE_ENV=test. Use: NODE_ENV=test npm test')
}

jest.setTimeout(10000)

beforeEach(() => {
  jest.clearAllMocks()
})

afterEach(() => {
  jest.restoreAllMocks()
})
