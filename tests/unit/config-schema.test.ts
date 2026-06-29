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
  required?: unknown
  properties?: Record<string, SchemaProperty>
  items?: SchemaProperty
}

interface ConfigSchema {
  pluginAlias: string
  pluginType: string
  customUiPath?: string
  schema: SchemaProperty & { properties: Record<string, SchemaProperty> }
  layout: unknown[]
}

/**
 * Collect every `required` value found anywhere in the schema tree. config-ui-x
 * validates the saved config with ajv (draft-07), where `required` MUST be an
 * array of property names at the object level. A boolean `"required": true` on
 * an individual field makes the whole schema fail to compile, so config-ui-x
 * cannot validate and reports "Config validation failed" for every config.
 */
function collectRequiredValues(node: SchemaProperty | undefined, found: unknown[]): void {
  if (!node || typeof node !== 'object') {
    return
  }
  if ('required' in node) {
    found.push(node.required)
  }
  if (node.properties) {
    for (const child of Object.values(node.properties)) {
      collectRequiredValues(child, found)
    }
  }
  collectRequiredValues(node.items, found)
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

  it('never declares `required` as a boolean (invalid draft-07; breaks ajv validation)', () => {
    const requiredValues: unknown[] = []
    collectRequiredValues(schema.schema, requiredValues)
    for (const value of requiredValues) {
      expect(Array.isArray(value)).toBe(true)
    }
  })

  it('requires the platform name so Homebridge 2.x does not warn on startup', () => {
    expect(schema.schema.required).toEqual(expect.arrayContaining(['name']))
  })

  it('does not require deviceID at the schema level (enforced at startup instead)', () => {
    // config-ui-x can materialize an empty per-device row; a schema `required`
    // would flag it as invalid on a fresh install. The plugin validates/ignores
    // overrides missing a deviceID at startup, so the schema must stay lenient.
    const deviceItems = schema.schema.properties.options?.properties?.devices?.items
    expect(deviceItems?.required).toBeUndefined()
  })

  it('declares no defaults inside per-device items (config-ui-x would fabricate a phantom override)', () => {
    const deviceItems = schema.schema.properties.options?.properties?.devices?.items
    const itemProps = deviceItems?.properties ?? {}
    const withDefaults = Object.entries(itemProps)
      .filter(([, prop]) => 'default' in prop)
      .map(([key]) => key)
    expect(withDefaults).toEqual([])
  })
})
