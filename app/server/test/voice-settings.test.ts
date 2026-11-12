import { beforeEach, describe, expect, it } from 'vitest'

import type { BotDeps } from '../src/bots/create.js'
import { VOICE_CONFIG, applyVoiceSettings, resetMemory } from '../src/voice/bot-settings.js'
import { PLATFORM_HINT } from '../src/voice/copy.js'
import { FakeRest } from './fake-rpc.js'

let rest: FakeRest
let deps: Pick<BotDeps, 'rest'>
beforeEach(() => {
  rest = new FakeRest()
  deps = { rest: { request: rest.request } as BotDeps['rest'] }
})

describe('voice settings', () => {
  it('writes only display.memory_notifications and platform_hints.cli in one PUT', async () => {
    rest.configs.set('scout', { display: { personality: 'noir' } })
    expect(await applyVoiceSettings(deps, 'scout')).toBe('written')
    const puts = rest.writes()
    expect(puts).toHaveLength(1)
    expect((puts[0]!.body as { config: unknown }).config).toEqual(VOICE_CONFIG)
    expect(VOICE_CONFIG).toEqual({ display: { memory_notifications: 'off' }, platform_hints: { cli: { replace: PLATFORM_HINT } } })
    expect(rest.configs.get('scout')!.display).toEqual({ personality: 'noir', memory_notifications: 'off' })
  })

  it('writes nothing when both already match', async () => {
    rest.configs.set('scout', { display: { memory_notifications: 'off' }, platform_hints: { cli: { replace: PLATFORM_HINT } } })
    expect(await applyVoiceSettings(deps, 'scout')).toBe('unchanged')
    expect(rest.writes()).toEqual([])
  })

  it('resets memory with target all for that profile and refuses the primary', async () => {
    rest.routes.set('POST /api/memory/reset', () => ({ ok: true }))
    await resetMemory(deps, 'scout')
    expect(rest.writes()).toEqual([{ method: 'POST', path: '/api/memory/reset', query: { profile: 'scout' }, body: { target: 'all' } }])
    await expect(resetMemory(deps, 'default')).rejects.toThrow()
    expect(rest.writes()).toHaveLength(1)
  })
})
