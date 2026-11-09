import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeClient } from './fake-client'

const client = new FakeClient()
vi.mock('@/chat/gateway', () => ({ connectGateway: () => client }))

const rfbs = vi.hoisted(() => ({ list: [] as { disconnects: number; emit(type: string): void }[] }))
vi.mock('@novnc/novnc', () => {
  class FakeRfb {
    viewOnly = true
    disconnects = 0
    private listeners = new Map<string, (() => void)[]>()
    constructor(public target: HTMLElement) { rfbs.list.push(this) }
    addEventListener(type: string, fn: () => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]) }
    emit(type: string) { for (const fn of this.listeners.get(type) ?? []) fn() }
    disconnect() { this.disconnects += 1 }
    focus() {}
    blur() {}
    clipboardPasteFrom() {}
    sendKey() {}
  }
  return { default: FakeRfb }
})

class FakeSocket {
  static instances: FakeSocket[] = []
  binaryType = ''
  closedWith: (number | undefined)[] = []
  constructor(public url: string) { FakeSocket.instances.push(this) }
  addEventListener() {}
  close(code?: number) { this.closedWith.push(code) }
}

import { createDialBudget } from '@/features/computer/dial-budget'
import { LiveSession } from '@/features/computer/live-session'
import type { SessionUi } from '@/features/computer/session-types'

const lease = { holder: 'agent', since: 1, epoch: 1 }
const ui = (): SessionUi => ({ setLink: vi.fn(), setError: vi.fn(), setNotice: vi.fn(), onOurs: vi.fn(), onLease: vi.fn(), refresh: async () => null, holding: () => false })
const make = (max: number) => new LiveSession('scout', ui(), { budget: createDialBudget({ max, windowMs: 10_000, mountDelayMs: 0 }) })
const until = async (check: () => boolean) => { for (let i = 0; i < 100 && !check(); i++) await new Promise(r => setTimeout(r, 10)); expect(check()).toBe(true) }

beforeEach(() => {
  FakeSocket.instances = []
  rfbs.list = []
  client.calls = []
  client.setState('open')
  client.handlers = { 'display.observe': () => ({ profile: 'scout', running: true, lease, viewer_id: 'v1', ticket: 't' }) }
  vi.stubGlobal('WebSocket', FakeSocket)
})

describe('LiveSession host swaps', () => {
  it('ignores a late detach from a host that is no longer attached', async () => {
    const session = make(10)
    const a = document.createElement('div')
    const b = document.createElement('div')
    session.attach(a)
    await until(() => rfbs.list.length === 1)
    session.attach(b)
    await until(() => rfbs.list.length === 2)
    session.detach(a) // the closing Expand dialog unmounts late
    await Promise.resolve()
    await Promise.resolve()
    expect(rfbs.list[1]!.disconnects).toBe(0)
    expect(FakeSocket.instances[1]!.closedWith).toEqual([])
  })

  it('closes the old stream when a refused dial leaves the new host without one', async () => {
    const session = make(1)
    const a = document.createElement('div')
    const b = document.createElement('div')
    session.attach(a)
    await until(() => rfbs.list.length === 1) // never reached connect, so no refund
    session.attach(b) // the budget refuses this dial
    session.detach(a)
    await Promise.resolve()
    await Promise.resolve()
    expect(rfbs.list).toHaveLength(1)
    expect(rfbs.list[0]!.disconnects).toBeGreaterThan(0)
    expect(FakeSocket.instances[0]!.closedWith).not.toContain(1000)
    expect(client.callsOf('display.lease.release')).toHaveLength(0)
  })
})
