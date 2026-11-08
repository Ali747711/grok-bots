import { describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'

const app = createApp({ config: loadConfig({ HOME: '/home/ali' }) })

describe('host guard', () => {
  it('rejects a foreign Host with 400', async () => {
    const res = await app.request('/crew/health', { headers: { Host: 'evil.example:7070' } })
    expect(res.status).toBe(400)
  })

  it('rejects a request with the right host but wrong port', async () => {
    const res = await app.request('/crew/health', { headers: { Host: '127.0.0.1:9120' } })
    expect(res.status).toBe(400)
  })

  it.each(['127.0.0.1:7070', 'localhost:7070'])('allows %s', async (host) => {
    const res = await app.request('/crew/health', { headers: { Host: host } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
