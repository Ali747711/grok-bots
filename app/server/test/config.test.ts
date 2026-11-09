import { describe, expect, it } from 'vitest'

import { loadConfig } from '../src/config.js'

describe('loadConfig', () => {
  it('defaults to loopback 7070 and Hermes 9120', () => {
    const c = loadConfig({ HOME: '/home/ali' })
    expect(c).toMatchObject({
      host: '127.0.0.1',
      port: 7070,
      hermesUrl: 'http://127.0.0.1:9120',
      hermesTokenFile: '/home/ali/.hermes/webapp/session-token',
      stateDir: '/home/ali/.config/crew'
    })
    expect(c.allowedHosts).toEqual(['127.0.0.1:7070', 'localhost:7070'])
    expect(c.allowedOrigins).toEqual(['http://127.0.0.1:7070', 'http://localhost:7070'])
  })

  it('applies env overrides and expands ~', () => {
    const c = loadConfig({ HOME: '/h', CREW_PORT: '7171', CREW_STATE_DIR: '~/crew-state' })
    expect(c.port).toBe(7171)
    expect(c.stateDir).toBe('/h/crew-state')
    expect(c.allowedHosts).toEqual(['127.0.0.1:7171', 'localhost:7171'])
  })

  it('rejects a non-numeric CREW_PORT', () => {
    expect(() => loadConfig({ HOME: '/h', CREW_PORT: 'abc' })).toThrow()
  })

  it('rejects a missing HOME', () => {
    expect(() => loadConfig({})).toThrow()
  })
})
