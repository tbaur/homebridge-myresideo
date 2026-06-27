#!/usr/bin/env node
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview One-off helper to obtain the initial Resideo / Honeywell Home
 * OAuth2 refresh token via the Authorization Code flow.
 *
 * It starts a temporary localhost server on your registered redirect URI, opens
 * the Resideo authorize page in your browser, captures the returned `code`, and
 * exchanges it for tokens. The token exchange itself lives in (and is unit
 * tested via) `src/api/auth.ts` -- this script only wires up the browser/callback
 * plumbing around it.
 *
 * Usage:
 *   npm run build            # ensure dist/ is current
 *   node scripts/get-tokens.mjs \
 *     --key <CONSUMER_KEY> --secret <CONSUMER_SECRET> \
 *     [--redirect-uri http://localhost:8581/oauth/callback]
 *
 * Credentials may also be supplied via env vars:
 *   RESIDEO_CONSUMER_KEY, RESIDEO_CONSUMER_SECRET, RESIDEO_REDIRECT_URI
 *
 * The `--redirect-uri` MUST byte-for-byte match the Callback URL registered on
 * your Resideo developer application, and must point at localhost/127.0.0.1 so
 * this script can receive the redirect.
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DEFAULT_REDIRECT_URI = 'http://localhost:8581/oauth/callback'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST_AUTH = resolve(HERE, '..', 'dist', 'api', 'auth.js')

/** Parse `--flag value` / `--flag=value` style arguments into a map. */
function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const eq = token.indexOf('=')
    if (eq !== -1) {
      args[token.slice(2, eq)] = token.slice(eq + 1)
    } else {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        args[token.slice(2)] = next
        i++
      } else {
        args[token.slice(2)] = 'true'
      }
    }
  }
  return args
}

async function prompt(question) {
  const rl = createInterface({ input: stdin, output: stdout })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}

function openBrowser(url) {
  const platform = process.platform
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true })
    child.on('error', () => {})
    child.unref()
  } catch {
    // Non-fatal: the URL is printed for manual opening.
  }
}

/**
 * Start the localhost callback server and resolve with the captured `code` once
 * Resideo redirects back. The browser is opened only after the listener is ready
 * (from inside the `listen` callback) so the redirect can never arrive early.
 */
function captureAuthorizationCode(redirectUri, authorizeUrl) {
  const url = new URL(redirectUri)
  if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    return Promise.reject(
      new Error(`--redirect-uri must use localhost or 127.0.0.1 so this script can receive the redirect (got "${url.hostname}")`),
    )
  }
  const port = url.port ? Number(url.port) : 80
  const expectedPath = url.pathname

  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer((req, res) => {
      const requestUrl = new URL(req.url ?? '/', `http://${url.host}`)
      if (requestUrl.pathname !== expectedPath) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Not found')
        return
      }

      const error = requestUrl.searchParams.get('error')
      const code = requestUrl.searchParams.get('code')
      const finish = (statusMessage, ok) => {
        res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html' })
        res.end('<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:2rem">'
          + `<h2>${ok ? 'Authorization complete' : 'Authorization failed'}</h2>`
          + `<p>${statusMessage}</p><p>You can close this tab and return to the terminal.</p></body>`)
        server.close()
      }

      if (error) {
        finish(`Resideo returned an error: ${error}`, false)
        rejectPromise(new Error(`Authorization was denied or failed: ${error}`))
        return
      }
      if (!code) {
        finish('No authorization code was present in the redirect.', false)
        rejectPromise(new Error('Redirect did not include an authorization code'))
        return
      }
      finish('Tokens are being exchanged in your terminal.', true)
      resolvePromise(code)
    })

    server.on('error', rejectPromise)
    server.listen(port, url.hostname, () => {
      stdout.write(`\nListening for the redirect on ${redirectUri}\n`)
      stdout.write('Opening your browser to authorize...\n')
      stdout.write(`If it does not open, paste this URL manually:\n\n${authorizeUrl}\n\n`)
      openBrowser(authorizeUrl)
    })
  })
}

async function loadAuthModule() {
  try {
    return await import(pathToFileURL(DIST_AUTH).href)
  } catch (err) {
    throw new Error(
      `Could not load the compiled token exchange from dist/. Run "npm run build" first.\nOriginal error: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const { buildAuthorizeUrl, exchangeAuthorizationCode } = await loadAuthModule()

  const redirectUri = args['redirect-uri'] || process.env.RESIDEO_REDIRECT_URI || DEFAULT_REDIRECT_URI
  let consumerKey = args.key || process.env.RESIDEO_CONSUMER_KEY || ''
  let consumerSecret = args.secret || process.env.RESIDEO_CONSUMER_SECRET || ''

  if (!consumerKey) consumerKey = await prompt('Consumer Key (API Key): ')
  if (!consumerSecret) consumerSecret = await prompt('Consumer Secret (API Secret): ')

  if (!consumerKey || !consumerSecret) {
    throw new Error('Both a Consumer Key and Consumer Secret are required.')
  }

  const authorizeUrl = buildAuthorizeUrl(consumerKey, redirectUri)

  stdout.write(`\nRedirect URI: ${redirectUri}\n`)
  stdout.write('This must exactly match the Callback URL registered on your Resideo app.\n')

  const code = await captureAuthorizationCode(redirectUri, authorizeUrl)
  stdout.write('\nAuthorization code received; exchanging for tokens...\n')

  const tokens = await exchangeAuthorizationCode({
    consumerKey,
    consumerSecret,
    code,
    redirectUri,
  })

  stdout.write('\n================ SUCCESS ================\n')
  stdout.write(`refreshToken: ${tokens.refresh_token}\n`)
  stdout.write(`accessToken:  ${tokens.access_token}\n`)
  stdout.write(`expires_in:   ${tokens.expires_in}\n`)
  stdout.write('\nPaste into your Homebridge config "credentials" block:\n\n')
  stdout.write(JSON.stringify(
    {
      consumerKey,
      consumerSecret,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
    },
    null,
    2,
  ) + '\n')
}

main().catch((err) => {
  process.exitCode = 1
  stdout.write(`\nError: ${err instanceof Error ? err.message : String(err)}\n`)
})
