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

  it('voiceScope defaults to e2e and accepts all', () => {
    expect(loadConfig({ HOME: '/h' }).voiceScope).toBe('e2e')
    expect(loadConfig({ HOME: '/h', CREW_VOICE_SCOPE: 'all' }).voiceScope).toBe('all')
    expect(() => loadConfig({ HOME: '/h', CREW_VOICE_SCOPE: 'some' })).toThrow()
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

  it('defaults hermesHome to ~/.hermes and expands CREW_HERMES_HOME', () => {
    expect(loadConfig({ HOME: '/h' }).hermesHome).toBe('/h/.hermes')
    expect(loadConfig({ HOME: '/h', CREW_HERMES_HOME: '~/other' }).hermesHome).toBe('/h/other')
    expect(loadConfig({ HOME: '/h', CREW_HERMES_HOME: '/srv/hermes' }).hermesHome).toBe('/srv/hermes')
  })

  it('refuses a relative CREW_HERMES_HOME or one with a colon or comma', () => {
    for (const bad of ['relative/dir', 'hermes', '/a:b', '/a,b', '~/a:b']) {
      expect(() => loadConfig({ HOME: '/h', CREW_HERMES_HOME: bad }), bad).toThrow()
    }
  })

  it('defaults composioKeyFile to ~/.config/crew/composio-key and honours CREW_COMPOSIO_KEY_FILE', () => {
    expect(loadConfig({ HOME: '/h' }).composioKeyFile).toBe('/h/.config/crew/composio-key')
    expect(loadConfig({ HOME: '/h', CREW_COMPOSIO_KEY_FILE: '~/k/key' }).composioKeyFile).toBe('/h/k/key')
    expect(loadConfig({ HOME: '/h', CREW_COMPOSIO_KEY_FILE: '/srv/key' }).composioKeyFile).toBe('/srv/key')
  })
})
