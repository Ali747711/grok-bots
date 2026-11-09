#!/usr/bin/env node
// Crew boundary check, run on the Mac through `ssh -N -L 7070:127.0.0.1:7070 ali@192.168.64.16`.
// Usage: node app/scripts/boundary-check.mjs --cookie-file <path> [--reuse]
//   --reuse  skip login and use the cookie saved by a previous run (reboot check).
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'

import WebSocket from 'ws'

const BASE = 'http://127.0.0.1:7070'
const ORIGIN = BASE
const VM = 'ali@192.168.64.16'
const args = process.argv.slice(2)
const cookieFile = args[args.indexOf('--cookie-file') + 1]
const reuse = args.includes('--reuse')
const results = []

function record(name, pass, detail) {
  results.push({ name, pass })
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}\n`)
}

function http(method, path, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const req = request(`${BASE}${path}`, { method, headers }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }))
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

function ws(headers, origin, waitForReady) {
  return new Promise(resolve => {
    const sock = new WebSocket(`ws://127.0.0.1:7070/api/ws`, { headers, ...(origin ? { origin } : {}) })
    const done = result => { sock.terminate(); resolve(result) }
    const timer = setTimeout(() => done({ outcome: 'timeout' }), 5000)
    sock.on('unexpected-response', (_req, res) => { clearTimeout(timer); done({ outcome: `http ${res.statusCode}` }) })
    sock.on('error', e => { clearTimeout(timer); done({ outcome: `error ${e.message}` }) })
    sock.on('open', () => { if (!waitForReady) { clearTimeout(timer); done({ outcome: 'open' }) } })
    sock.on('message', data => {
      const frame = JSON.parse(data.toString())
      if (frame.method === 'event' && frame.params?.type === 'gateway.ready') { clearTimeout(timer); done({ outcome: 'ready' }) }
    })
  })
}

async function login() {
  const out = execFileSync('ssh', ['-o', 'BatchMode=yes', VM, 'node ~/projects/grok-bots/app/server/dist/cli/crew.js login'], { encoding: 'utf8' })
  const ticket = out.match(/#ticket=([A-Za-z0-9_-]+)/)?.[1]
  const res = await http('POST', '/crew/login', { Host: '127.0.0.1:7070', Origin: ORIGIN, 'Content-Type': 'application/json' }, JSON.stringify({ ticket }))
  const cookie = (res.headers['set-cookie'] ?? []).map(c => c.split(';')[0]).join('; ')
  record('login with a fresh crew login link → 204 + cookies', res.status === 204 && cookie.includes('crew_session='), `status ${res.status}`)
  return cookie
}

async function main() {
  const host = { Host: '127.0.0.1:7070' }
  if (!reuse) {
    const bad = await http('GET', '/crew/health', { Host: 'evil.example:7070' })
    record('foreign Host → 400', bad.status === 400, `status ${bad.status}`)
    const anon = await http('GET', '/api/profiles', host)
    record('GET /api/profiles without cookie → 401', anon.status === 401, `status ${anon.status}`)
  }
  const cookie = reuse ? readFileSync(cookieFile, 'utf8').trim() : await login()
  if (!reuse) writeFileSync(cookieFile, cookie, { mode: 0o600 })

  if (!reuse) {
    const evilWs = await ws({ Cookie: cookie }, 'http://evil.example', false)
    record('WS with foreign Origin → refused', evilWs.outcome === 'http 403', evilWs.outcome)
    const noOriginWs = await ws({ Cookie: cookie }, undefined, false)
    record('WS with no Origin → refused', noOriginWs.outcome === 'http 403', noOriginWs.outcome)
    const csrfLess = await http('POST', '/crew/whoami', { ...host, Cookie: cookie, Origin: 'http://evil.example' })
    record('POST with cookie but foreign Origin → 403', csrfLess.status === 403, `status ${csrfLess.status}`)
  }

  const profiles = await http('GET', '/api/profiles', { ...host, Cookie: cookie })
  const names = profiles.status === 200 ? JSON.parse(profiles.body).profiles?.map(p => p.name) ?? [] : []
  record('GET /api/profiles with cookie → 200 incl. default', profiles.status === 200 && names.includes('default'), `status ${profiles.status}, profiles ${names.join(',')}`)
  const goodWs = await ws({ Cookie: cookie }, ORIGIN, true)
  record('WS with cookie + Crew Origin → gateway.ready', goodWs.outcome === 'ready', goodWs.outcome)

  const failed = results.filter(r => !r.pass).length
  process.stdout.write(`\n${results.length - failed}/${results.length} passed\n`)
  process.exit(failed ? 1 : 0)
}

main().catch(e => { process.stderr.write(`boundary-check crashed: ${e.message}\n`); process.exit(1) })
