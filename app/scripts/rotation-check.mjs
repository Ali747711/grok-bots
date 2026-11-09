#!/usr/bin/env node
// Live token-rotation check (design §9 Phase 0): run on the Mac through the 7070 tunnel.
// Usage: node app/scripts/rotation-check.mjs --cookie-file <path>
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { request } from 'node:http'

import WebSocket from 'ws'

const VM = 'ali@192.168.64.16'
const cookie = readFileSync(process.argv[process.argv.indexOf('--cookie-file') + 1], 'utf8').trim()
const headers = { Host: '127.0.0.1:7070', Cookie: cookie }
const ssh = cmd => execFileSync('ssh', ['-o', 'BatchMode=yes', VM, cmd], { encoding: 'utf8' }).trim()
const tokenHash = () => ssh('sha256sum ~/.hermes/webapp/session-token | cut -c1-12')
const out = s => process.stdout.write(s + '\n')

const get = path => new Promise((resolve, reject) => {
  request(`http://127.0.0.1:7070${path}`, { headers }, res => {
    let body = ''
    res.on('data', c => { body += c })
    res.on('end', () => resolve({ status: res.statusCode, body }))
  }).on('error', reject).end()
})

function openWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:7070/api/ws', { headers: { Cookie: cookie }, origin: 'http://127.0.0.1:7070' })
    const timer = setTimeout(() => reject(new Error('no gateway.ready in 8 s')), 8000)
    ws.on('message', d => {
      const f = JSON.parse(d.toString())
      if (f.method === 'event' && f.params?.type === 'gateway.ready') { clearTimeout(timer); resolve(ws) }
    })
    ws.on('unexpected-response', (_q, r) => { clearTimeout(timer); reject(new Error(`HTTP ${r.statusCode}`)) })
    ws.on('error', e => { clearTimeout(timer); reject(e) })
  })
}

const pause = ms => new Promise(r => setTimeout(r, ms))

const before = tokenHash()
out(`token before: ${before}`)
const ws = await openWs()
out('WS open via Crew, gateway.ready received')
const closed = new Promise(resolve => ws.on('close', (code, reason) => resolve(`${code} ${reason}`)))
out(`sign-out: ${ssh('export PATH=$HOME/.local/bin:$PATH; hermes webapp --sign-out 2>&1 | tail -1')}`)
const after = tokenHash()
out(`token after: ${after} (${after === before ? 'UNCHANGED' : 'rotated'})`)
out(`existing WS closed with: ${await Promise.race([closed, pause(8000).then(() => 'still open after 8 s')])}`)
const rest = await get('/api/profiles')
out(`REST /api/profiles after rotation: ${rest.status}`)
const ws2 = await openWs().then(() => 'gateway.ready', e => `failed: ${e.message}`)
out(`new WS after rotation: ${ws2}`)
await pause(12000)
const pending = JSON.parse((await get('/crew/pending')).body)
const tail = pending.debug.slice(-12).filter(d => d.kind !== 'event' || d.detail.startsWith('gateway.ready'))
out(`watcher (last entries): ${JSON.stringify(tail.map(d => `${d.kind}: ${d.detail.slice(0, 60)}`))}`)
process.exit(0)
