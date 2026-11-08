import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (event: unknown) => void

class FakeSocket {
  static OPEN = 1
  static instances: FakeSocket[] = []
  readyState = 1
  sent: Record<string, unknown>[] = []
  private listeners = new Map<string, Listener[]>()
  constructor(public url: string) { FakeSocket.instances.push(this) }
  addEventListener(type: string, l: Listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), l]) }
  removeEventListener(type: string, l: Listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(x => x !== l)) }
  send(text: string) { this.sent.push(JSON.parse(text)) }
  close() { this.readyState = 3 }
  fire(type: string, event: unknown = {}) { for (const l of [...(this.listeners.get(type) ?? [])]) l(event) }
  deliver(frame: unknown) { this.fire('message', { data: JSON.stringify(frame) }) }
}

beforeEach(() => {
  FakeSocket.instances = []
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.resetModules()
})
afterEach(() => vi.unstubAllGlobals())

async function connected() {
  const { connectGateway } = await import('@/chat/gateway')
  const client = connectGateway()
  const socket = FakeSocket.instances[0]!
  socket.fire('open')
  await Promise.resolve()
  return { client, socket }
}

const responsesTo = (socket: FakeSocket, id: string) => socket.sent.filter(f => f.id === id)

describe('connectGateway', () => {
  it('dials the same-origin /api/ws', async () => {
    const { socket } = await connected()
    expect(socket.url).toMatch(/^wss?:\/\/[^/]+\/api\/ws$/)
  })

  it('never answers a live server request (no automatic skip)', async () => {
    const { socket } = await connected()
    socket.deliver({ jsonrpc: '2.0', id: 'srq-1', method: 'secret.request', params: { prompt: 'API key' } })
    expect(responsesTo(socket, 'srq-1')).toEqual([])
  })

  it('never answers a replayed open_requests entry from a resume result', async () => {
    const { client, socket } = await connected()
    const pending = client.request('session.resume', { session_id: 's' })
    const call = socket.sent.find(f => f.method === 'session.resume')!
    socket.deliver({ jsonrpc: '2.0', id: call.id, result: { session_id: 's', open_requests: [{ id: 'srq-2', method: 'sudo.request', params: {} }] } })
    await pending
    expect(responsesTo(socket, 'srq-2')).toEqual([])
  })

  it('returns the same client on every call', async () => {
    const { connectGateway } = await import('@/chat/gateway')
    expect(connectGateway()).toBe(connectGateway())
  })
})
