import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import type { BotDeps } from '../src/bots/create.js'
import { NOW_CLOSE, NOW_OPEN, composeSoul, nowOf, ownerPartOf } from '../src/bots/soul.js'
import { PLATFORM_HINT } from '../src/voice/copy.js'
import { createVoiceService, writeRightNow } from '../src/voice/service.js'
import { VoiceStore } from '../src/voice/voice-store.js'
import { FakeRest } from './fake-rpc.js'

const block = (text: string) => `${NOW_OPEN}\n## Right now\n${text}\n${NOW_CLOSE}`
let rest: FakeRest
let deps: Pick<BotDeps, 'rest'>
const prompt = (bot: string) => ((rest.configs.get(bot)?.agent ?? {}) as Record<string, unknown>).system_prompt
const configWrites = () => rest.writes().filter(w => w.path === '/api/config')

beforeEach(() => {
  rest = new FakeRest()
  deps = { rest: { request: rest.request } as BotDeps['rest'] }
  rest.soul('scout', composeSoul('Be kind.'))
})

describe('writeRightNow', () => {
  it('writes the block into agent.system_prompt and keeps the owner text', async () => {
    rest.configs.set('scout', { agent: { system_prompt: 'Always answer in English.' } })
    expect(await writeRightNow(deps, 'scout', block('one'))).toBe('written')
    expect(prompt('scout')).toBe(`Always answer in English.\n\n${block('one')}`)
    expect(rest.souls.get('scout')).toBe(composeSoul('Be kind.'))
  })

  it('writes nothing when the block is unchanged', async () => {
    await writeRightNow(deps, 'scout', block('one'))
    const before = rest.writes().length
    expect(await writeRightNow(deps, 'scout', block('one'))).toBe('unchanged')
    expect(rest.writes()).toHaveLength(before)
  })

  it('a personality moves the block into the Soul and back', async () => {
    await writeRightNow(deps, 'scout', block('one'))
    rest.configs.set('scout', { ...rest.configs.get('scout'), display: { personality: 'noir' } })
    expect(await writeRightNow(deps, 'scout', block('two'))).toBe('written')
    expect(nowOf(rest.souls.get('scout')!)).toBe(block('two'))
    expect(ownerPartOf(rest.souls.get('scout')!)).toBe('Be kind.')
    expect(prompt('scout')).toBe('')
    rest.configs.set('scout', { ...rest.configs.get('scout'), display: { personality: 'none' } })
    expect(await writeRightNow(deps, 'scout', block('three'))).toBe('written')
    expect(prompt('scout')).toBe(block('three'))
    expect(nowOf(rest.souls.get('scout')!)).toBeNull()
    expect(rest.souls.get('scout')).toBe(composeSoul('Be kind.'))
  })

  it('never writes display.personality', async () => {
    rest.configs.set('scout', { display: { personality: 'noir' }, agent: { system_prompt: `x\n\n${block('old')}` } })
    await writeRightNow(deps, 'scout', block('new'))
    for (const w of configWrites()) expect(JSON.stringify(w.body)).not.toContain('personality')
    expect((rest.configs.get('scout')!.display as Record<string, unknown>).personality).toBe('noir')
  })

  it('waits for migration on the Soul carrier when the Soul has no house block', async () => {
    rest.soul('scout', 'Their own soul')
    rest.configs.set('scout', { display: { personality: 'noir' } })
    expect(await writeRightNow(deps, 'scout', block('one'))).toBe('waiting_for_migration')
    expect(rest.writes()).toEqual([])
  })

  it('leaves a non-string system_prompt alone and uses the Soul', async () => {
    rest.configs.set('scout', { agent: { system_prompt: ['a', 'b'] } })
    expect(await writeRightNow(deps, 'scout', block('one'))).toBe('written')
    expect(prompt('scout')).toEqual(['a', 'b'])
    expect(nowOf(rest.souls.get('scout')!)).toBe(block('one'))
  })
})

describe('prepare, markNew and forget', () => {
  async function service() {
    const store = await VoiceStore.load(join(await mkdtemp(join(tmpdir(), 'crew-voice-svc-')), 'voice.json'))
    rest.routes.set('GET /api/tools/toolsets', () => [{ name: 'memory', label: '', description: '', platform: 'cli', enabled: true, configured: true }])
    rest.routes.set('POST /api/memory/reset', () => ({ ok: true }))
    rest.configs.set('scout', {})
    const bots = { rest: { request: rest.request } } as unknown as BotDeps
    const svc = createVoiceService({
      bots, hermesHome: '/h', store, inScope: () => true,
      owner: () => ({ name: 'Ali', timeZone: null }), roster: () => [], groups: () => ({ available: true, seatable: [], rooms: [] }),
      apps: () => [], routines: async () => []
    })
    return { svc, store }
  }
  const order = () => rest.writes().map(w => w.path === '/api/config' ? Object.keys((w.body as { config: Record<string, unknown> }).config).join('+') : w.path)

  it('a new bot gets its memory reset, then voice settings, then its block, and its version recorded', async () => {
    const { svc, store } = await service()
    await svc.markNew('scout')
    await svc.prepare('scout')
    expect(order()).toEqual(['/api/memory/reset', 'display+platform_hints', 'agent'])
    expect(rest.configs.get('scout')!.platform_hints).toEqual({ cli: { replace: PLATFORM_HINT } })
    expect(store.get('scout')).toEqual({ resetPending: false, soulVersion: 1 })
  })

  it('finish resets memory only when the bot is marked new', async () => {
    const { svc } = await service()
    await svc.prepare('scout')
    expect(order()).not.toContain('/api/memory/reset')
  })

  it('forget drops the record', async () => {
    const { svc, store } = await service()
    await svc.markNew('scout')
    await svc.forget('scout')
    expect(store.get('scout')).toBeUndefined()
  })
})
