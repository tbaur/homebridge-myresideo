/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * Regression coverage for config.schema.json. The account-linking UI writes a
 * `credentials` object and config-ui-x reconstructs/validates the saved config
 * from this schema, so any credential field the schema fails to declare is
 * stripped on save — which previously prevented the refresh token from ever
 * persisting to config.json. These tests fail fast if that contract regresses.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

interface SchemaProperty {
  type?: string
  properties?: Record<string, SchemaProperty>
}

interface ConfigSchema {
  pluginAlias: string
  pluginType: string
  customUiPath?: string
  schema: { properties: Record<string, SchemaProperty> }
  layout: unknown[]
}

function loadSchema(): ConfigSchema {
  const raw = readFileSync(resolve(__dirname, '../../config.schema.json'), 'utf8')
  return JSON.parse(raw) as ConfigSchema
}

describe('config.schema.json', () => {
  const schema = loadSchema()

  it('uses the platform alias the plugin registers under', () => {
    expect(schema.pluginAlias).toBe('MyResideo')
    expect(schema.pluginType).toBe('platform')
  })

  it('declares a credentials object so config-ui-x preserves it on save', () => {
    const credentials = schema.schema.properties.credentials
    expect(credentials).toBeDefined()
    expect(credentials.type).toBe('object')
  })

  it.each(['consumerKey', 'consumerSecret', 'accessToken', 'refreshToken'])(
    'declares credentials.%s (read by the platform / written by the linking UI)',
    (field) => {
      const props = schema.schema.properties.credentials?.properties ?? {}
      expect(props[field]).toBeDefined()
      expect(props[field].type).toBe('string')
    },
  )

  it('keeps credentials out of the rendered layout (managed by the linking UI)', () => {
    const layoutJson = JSON.stringify(schema.layout)
    expect(layoutJson).not.toContain('credentials')
  })
})
