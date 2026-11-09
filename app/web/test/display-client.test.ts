import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeClient } from './fake-client'

const client = new FakeClient()
vi.mock('@/chat/gateway', () => ({ connectGateway: () => client }))

import * as display from '@/features/computer/display-client'

beforeEach(() => {
  client.calls = []
  client.handlers = {}
})

describe('display client', () => {
  it('never calls a display method without a profile', async () => {
    // @ts-expect-error profile is required
    await expect(display.status()).rejects.toThrow(/profile/)
    await expect(display.status('')).rejects.toThrow(/profile/)
    await expect(display.observe('  ')).rejects.toThrow(/profile/)
    await expect(display.thumbnail(undefined as unknown as string)).rejects.toThrow(/profile/)
    expect(client.calls).toHaveLength(0)
  })

  it('sends the profile on every call, with a 5 s thumbnail timeout', async () => {
    await display.status('scout')
    await display.observe('scout', 'v1')
    await display.observe('scout')
    await display.acquire('scout', 'v1')
    await display.release('scout', 'v1')
    await display.release('scout', { force: true })
    await display.thumbnail('scout')
    await display.stop('scout')
    expect(client.calls.map(c => c.method)).toEqual(['display.status', 'display.observe', 'display.observe', 'display.lease.acquire', 'display.lease.release', 'display.lease.release', 'display.thumbnail', 'display.stop'])
    expect(client.calls.every(c => c.params.profile === 'scout')).toBe(true)
    expect(client.calls[1]!.params).toEqual({ profile: 'scout', viewer_id: 'v1' })
    expect(client.calls[2]!.params).toEqual({ profile: 'scout' })
    expect(client.calls[4]!.params).toEqual({ profile: 'scout', viewer_id: 'v1' })
    expect(client.calls[5]!.params).toEqual({ profile: 'scout', force: true })
    expect(client.calls[6]!.timeoutMs).toBe(5000)
  })

  it('never sends display.start (the server route starts screens)', () => {
    expect('start' in display).toBe(false)
  })
})
