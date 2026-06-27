/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * Jest configuration for sandboxed testing
 * All tests run in isolation with mocked dependencies
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',

  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        // Override strict settings for tests
        strict: false,
        noImplicitAny: false,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
      },
    }],
  },

  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],

  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,

  maxWorkers: 1,

  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts', // Re-export files
    '!src/settings.ts', // Constants only
    '!src/platform.ts', // Integration-level HAP wiring; covered via integration tests
    '!src/devices/**', // Integration-level HAP wiring; covered via integration tests
  ],

  testMatch: [
    '**/tests/unit/**/*.test.ts',
    '**/tests/integration/**/*.test.ts',
  ],

  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
  ],

  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },

  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],

  testTimeout: 10000,
  verbose: true,
  forceExit: true,
  detectOpenHandles: true,
}
