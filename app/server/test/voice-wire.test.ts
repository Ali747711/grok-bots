import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BotDeps } from '../src/bots/create.js'
import { HOUSE_OPEN } from '../src/bots/soul.js'
import { loadConfig } from '../src/config.js'
import type { RoutineService } from '../src/routines/service.js'
import type { CrewStateSource } from '../src/state/crew-state.js'
import type { VoiceService } from '../src/voice/service.js'
import { wireVoice } from '../src/voice/wire.js'
import type { BotView } from '../src/watcher/bot-state.js'
import { FakeRest, FakeRpc } from './fake-rpc.js'

const ROSTER = ['default', 'bella', 'e2e1']
let rest: FakeRest
let rpc: FakeRpc
let stateDir: string
let service: VoiceService | null

beforeEach(async () => {
  rest = new FakeRest()
  rpc = new FakeRpc()
  stateDir = await mkdtemp(join(tmpdir(), 'crew-wire-'))
  service = null
  rest.routes.set('GET /api/tools/toolsets', () => [])
  for (const bot of ROSTER) {
    rest.configs.set(bot, {})
    rest.soul(bot, `Old soul of ${bot}`)
    rpc.meta(bot, { title: bot }, 1)
  }
})
afterEach(() => {
  service?.stop()
  vi.useRealTimers()
})

async function wire(scope: 'e2e' | 'all'): Promise<VoiceService> {
  const bots = { rpc: rpc.call, rest: { request: rest.request }, refresh: async () => undefined, now: () => 1 } as unknown as BotDeps
  const state = { hermes: 'connected', bots: ROSTER.map(name => ({ name, title: name, role: null, job: '', hidden: false }) as unknown as BotView), groups: { available: true, seatable: [], rooms: [] } }
  const crewState = { state: () => state, onChange: () => () => undefined } as unknown as CrewStateSource
  const settings = { get: () => ({ maxWorkingBots: 2, ownerName: null, timeZone: null }), onChange: () => () => undefined }
  const routines = { list: async () => [] } as unknown as RoutineService
  const config = { ...loadConfig({ HOME: '/h', CREW_STATE_DIR: stateDir, ...(scope === 'all' ? { CREW_VOICE_SCOPE: 'all' } : {}) }), hermesHome: '/h' }
  service = await wireVoice({ config, bots, crewState, settings, routines })
  return service
}

const migrated = (bot: string): boolean => (rest.souls.get(bot) ?? '').includes(HOUSE_OPEN)

describe('the voice scope gate', () => {
  it('in e2e scope the first pass rewrites only e2e bots', async () => {
    const svc = await wire('e2e')
    svc.start()
    await vi.waitFor(() => expect(migrated('e2e1')).toBe(true))
    expect(migrated('default')).toBe(false)
    expect(migrated('bella')).toBe(false)
    expect(svc.inScope('bella')).toBe(false)
    expect(svc.inScope('e2e1')).toBe(true)
  })

  it('in all scope the first pass rewrites every bot, the primary included', async () => {
    const svc = await wire('all')
    svc.start()
    await vi.waitFor(() => expect(ROSTER.every(migrated)).toBe(true))
  })

  it('a bot Crew prepared is in scope even in e2e scope', async () => {
    await writeFile(join(stateDir, 'voice.json'), JSON.stringify({ bots: { bella: { soulVersion: 1 } } }))
    const svc = await wire('e2e')
    expect(svc.inScope('bella')).toBe(true)
    expect(svc.inScope('default')).toBe(false)
  })

  it('drops voice records of bots that are no longer in the roster at the first pass', async () => {
    await writeFile(join(stateDir, 'voice.json'), JSON.stringify({ bots: { ghost: { resetPending: true }, e2e1: { soulVersion: 1 } } }))
    const svc = await wire('e2e')
    svc.start()
    await vi.waitFor(() => expect(svc.inScope('ghost')).toBe(false))
  })
})
