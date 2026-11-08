import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'

import { signSession } from '../src/auth/session-cookie.js'
import { loadConfig } from '../src/config.js'
import { checkBrowserFrame } from '../src/hermes/display-guard.js'
import { HermesToken } from '../src/hermes/token.js'
import { attachWsProxy } from '../src/hermes/ws-proxy.js'

const known = () => new Set(['default', 'crew-test', 'scout'])
const check = (text: string) => checkBrowserFrame(Buffer.from(text), false, known)
const call = (method: string, params?: unknown, id: number | string = 7) => JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })
const errorOf = (result: ReturnType<typeof check>) => {
  if (result.forward || !result.reply) throw new Error('expected a refusal with a reply')
  return JSON.parse(result.reply) as { jsonrpc: string; id: unknown; error: { code: number } }
}

describe('checkBrowserFrame', () => {
  it('refuses display frames Hermes would mis-target', () => {
    const cases: [string, number, unknown][] = [
      [call('display.status', {}), -32602, 7],
      [call('display.status'), -32602, 7],
      [call('display.status', { profile: ' crew-test' }), -32602, 7],
      [call('display.status', { profile: 'crew-test ' }), -32602, 7],
      [call('display.status', { profile: 'ghost' }), -32602, 7],
      [call('display.status', { profile: '' }), -32602, 7],
      [call('display.status', { profile: ['crew-test'] }), -32602, 7],
      [call('display.status', [{ profile: 'crew-test' }]), -32602, 7],
      ['{"jsonrpc":"2.0","id":3,"method":"display.status","params":{"profile":NaN}}', -32700, null],
      ['\u00a0{"id":3,"method":"display.status","params":{"profile":"crew-test"}}', -32700, null],
      ['{"id":3,', -32700, null],
      ['[{"id":1,"method":"display.status","params":{"profile":"crew-test"}}]', -32600, null],
      ['7', -32600, null],
      ['null', -32600, null],
      [call('display.start', { profile: 'crew-test' }), -32601, 7],
      [call('display.install', { profile: 'crew-test' }), -32601, 7],
      [call('display.installFoo', { profile: 'crew-test' }), -32601, 7],
      [call('display.switchSandboxImage', { profile: 'crew-test' }), -32601, 7],
      [call('display.somethingNew', { profile: 'crew-test' }), -32601, 7],
      ['{"jsonrpc":"2.0","id":1,"method":"display\\u002estart","params":{"profile":"crew-test"}}', -32601, 1],
      ['{"jsonrpc":"2.0","id":2,"method":"display.status"}', -32602, 2],
      ['{"jsonrpc":"2.0","id":3,"method":"prompt.submit","method":"display.status","params":{}}', -32602, 3],
      ['{"jsonrpc":"2.0","id":4,"method":"display.status","params":{"profile":false}}', -32602, 4],
      ['{"jsonrpc":"2.0","id":5,"method":"display.status","params":{"profile":0}}', -32602, 5],
      ['{"jsonrpc":"2.0","id":6,"method":"display.status","params":{"profile":null}}', -32602, 6],
      ['{"jsonrpc":"2.0","id":8,"method":"display.status","params":null}', -32602, 8],
      ['{"jsonrpc":"2.0","id":9,"method":"display.status","params":{"__proto__":{"profile":"crew-test"}}}', -32602, 9]
    ]
    for (const [text, code, id] of cases) {
      const reply = errorOf(check(text))
      expect([text, reply.error.code, reply.id]).toEqual([text, code, id])
      expect(reply.jsonrpc).toBe('2.0')
    }
    expect(checkBrowserFrame(Buffer.from([1, 2]), true, known)).toEqual({ forward: false })
  })

  it('forwards display.status/observe/lease/thumbnail/stop with a known profile unchanged', () => {
    for (const method of ['display.status', 'display.observe', 'display.lease.acquire', 'display.lease.release', 'display.thumbnail', 'display.stop']) {
      expect(check(call(method, { profile: 'crew-test', viewer_id: 'v' }))).toEqual({ forward: true })
    }
    expect(check(call('display.status', { profile: 'default' }))).toEqual({ forward: true })
  })

  it('forwards non-display frames byte-for-byte', () => {
    for (const text of [call('session.create', { profile: 'x' }), call('prompt.submit'), '{"id":1,"result":true}', '{"id":1,"method":"displays.x"}']) {
      expect(check(text)).toEqual({ forward: true })
    }
  })

  it('replies with the original request id', () => {
    expect(errorOf(check(call('display.start', { profile: 'crew-test' }, 'abc-1'))).id).toBe('abc-1')
    expect(errorOf(check(call('display.status', {}, 42))).id).toBe(42)
  })
})

describe('guard wiring on /api/ws', () => {
  const cookieKey = Buffer.alloc(32, 7)
  const now = () => 1_000_000
  const cookie = `crew_session=${signSession(cookieKey, { sid: 's', exp: now() + 60_000 })}`
  let upstream: WebSocketServer
  let crew: Server
  let got: string[]

  beforeEach(async () => {
    got = []
    upstream = new WebSocketServer({ port: 0, host: '127.0.0.1' })
    await new Promise<void>(resolve => upstream.on('listening', () => resolve()))
    upstream.on('connection', ws => ws.on('message', d => got.push(d.toString())))
    crew = createServer()
    await new Promise<void>(resolve => crew.listen(0, '127.0.0.1', resolve))
    const port = (crew.address() as AddressInfo).port
    const config = loadConfig({ HOME: '/home/ali', CREW_PORT: String(port), CREW_HERMES_URL: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}` })
    const token = new HermesToken('/unused')
    token.get = async () => 'tok'
    attachWsProxy(crew, { config, token, cookieKey, now, knownBots: known })
  })
  afterEach(async () => {
    for (const c of upstream.clients) c.terminate()
    await new Promise<void>(resolve => upstream.close(() => resolve()))
    crew.closeAllConnections()
    await new Promise<void>(resolve => crew.close(() => resolve()))
  })

  it('answers a refused frame to the browser, never forwards it, and relays the rest untouched', async () => {
    const port = (crew.address() as AddressInfo).port
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ws`, { origin: `http://127.0.0.1:${port}`, headers: { Cookie: cookie } })
    await new Promise<void>(resolve => ws.once('open', () => resolve()))
    const reply = new Promise<string>(resolve => ws.once('message', d => resolve(d.toString())))
    ws.send(call('display.start', { profile: 'crew-test' }, 9))
    expect(JSON.parse(await reply)).toMatchObject({ id: 9, error: { code: -32601 } })
    const raw = '{ "id": 10,  "method":"prompt.submit" }'
    ws.send(raw)
    for (let i = 0; i < 100 && got.length === 0; i++) await new Promise(r => setTimeout(r, 10))
    expect(got).toEqual([raw])
    ws.terminate()
  })
})
