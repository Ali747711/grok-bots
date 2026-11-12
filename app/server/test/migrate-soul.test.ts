import { mkdtemp, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import type { BotDeps } from '../src/bots/create.js'
import { HOUSE_OPEN, composeSoul, ownerPartOf } from '../src/bots/soul.js'
import { HERMES_STOCK_SOULS } from '../src/voice/hermes-stock-souls.js'
import { migrateAll, migrateBot, migratedOwnerPart, type MigrationDeps } from '../src/voice/migrate.js'
import { VoiceStore } from '../src/voice/voice-store.js'
import { FakeRest, FakeRpc } from './fake-rpc.js'

const OLD_BELLA = '# Bella\n\n**Mission:** X\n\nYou are Bella, a persistent named agent (profile `bella`) on this machine.\nYou keep your own memory, skills, and conversation history across sessions.\n\nAlways cite sources.'
const DAY = Date.UTC(2026, 10, 12, 3)

let rest: FakeRest
let rpc: FakeRpc
let dir: string
let deps: MigrationDeps
let events: string[]

async function makeDeps(): Promise<MigrationDeps> {
  const store = await VoiceStore.load(join(dir, 'voice.json'))
  const bots = { rpc: rpc.call, rest: { request: rest.request } } as unknown as BotDeps
  return { bots, store, backupDir: join(dir, 'soul-backups'), now: () => DAY, refreshNow: async bot => { events.push(`now:${bot}`) } }
}

beforeEach(async () => {
  rest = new FakeRest()
  rpc = new FakeRpc()
  events = []
  dir = await mkdtemp(join(tmpdir(), 'crew-migrate-'))
  rest.configs.set('bella', {})
  rpc.meta('bella', { title: 'Bella' }, 1)
  rpc.rows.get('bella')!.description = 'Writes songs'
  deps = await makeDeps()
})

const backups = async () => (await readdir(join(dir, 'soul-backups')).catch(() => [] as string[])).sort()

describe('migratedOwnerPart', () => {
  it('keeps custom text verbatim and drops only the two old template sentences', () => {
    expect(migratedOwnerPart(OLD_BELLA, { title: 'Bella', job: 'X' })).toEqual({ owner: '# Bella\n\n**Mission:** X\n\nAlways cite sources.', reason: 'crew_template' })
    expect(migratedOwnerPart('Be kind.\n\n\nTwo blank lines stay.', { title: 'B', job: '' })).toEqual({ owner: 'Be kind.\n\n\nTwo blank lines stay.', reason: 'kept' })
  })

  it('keeps the owner\'s own blank lines after a removed template sentence', () => {
    const soul = '# B\n\nYou are B, a persistent named agent (profile `b`) on this machine.\n\nRule one.\n\n\nRule two.'
    expect(migratedOwnerPart(soul, { title: 'B', job: '' }).owner).toBe('# B\n\nRule one.\n\n\nRule two.')
  })

  it.each(HERMES_STOCK_SOULS)('replaces a Hermes stock Soul with a short owner part (%#)', stock => {
    expect(migratedOwnerPart(stock, { title: 'Hermes', job: 'Run my day' })).toEqual({ owner: '# Hermes\n\n**Mission:** Run my day', reason: 'hermes_stock' })
  })

  it('treats a CRLF or BOM copy of the stock Soul as stock', () => {
    const crlf = `﻿${HERMES_STOCK_SOULS[1]!.replace(/\n/g, '\r\n')}\n`
    expect(migratedOwnerPart(crlf, { title: 'Hermes', job: '' })).toEqual({ owner: '# Hermes', reason: 'hermes_stock' })
  })

  it('gives an empty Soul a short owner part', () => {
    expect(migratedOwnerPart('  \n', { title: 'Bella', job: 'Writes songs' })).toEqual({ owner: '# Bella\n\n**Mission:** Writes songs', reason: 'empty' })
  })
})

describe('migrateBot', () => {
  it('backs up first, then writes hint and memory settings, then the Soul, then the Right-now block, then the record', async () => {
    rest.soul('bella', OLD_BELLA)
    rest.routes.set('PUT /api/profiles/bella/soul', req => {
      events.push(`soul:${backupsSync.length}`)
      rest.souls.set('bella', (req.body as { content: string }).content)
      return { ok: true }
    })
    let backupsSync: string[] = []
    const original = rest.request
    rest.request = async (method, path, opts) => {
      if (method === 'PUT' && path === '/api/config') { backupsSync = await backups(); events.push(`config:${backupsSync.length}`) }
      if (method === 'PUT' && path.endsWith('/soul')) backupsSync = await backups()
      return original(method, path, opts)
    }
    deps = await makeDeps()
    expect(await migrateBot(deps, 'bella')).toBe('migrated')
    expect(events).toEqual(['config:1', 'soul:1', 'now:bella'])
    expect(deps.store.get('bella')).toEqual({ soulVersion: 1 })
    expect(ownerPartOf(rest.souls.get('bella')!)).toBe('# Bella\n\n**Mission:** X\n\nAlways cite sources.')
    expect(await backups()).toEqual(['bella-2026-11-12.md'])
    expect((await stat(join(dir, 'soul-backups', 'bella-2026-11-12.md'))).mode & 0o777).toBe(0o600)
  })

  it('gives an empty or missing Soul a short owner part and writes no backup', async () => {
    expect(await migrateBot(deps, 'bella')).toBe('migrated')
    expect(ownerPartOf(rest.souls.get('bella')!)).toBe('# Bella\n\n**Mission:** Writes songs')
    expect(await backups()).toEqual([])
  })

  it('is idempotent: a second run is current and writes nothing', async () => {
    rest.soul('bella', OLD_BELLA)
    await migrateBot(deps, 'bella')
    const writes = rest.writes().length
    expect(await migrateBot(deps, 'bella')).toBe('current')
    expect(rest.writes()).toHaveLength(writes)
  })

  it('never overwrites a backup: same bot and day gets -2', async () => {
    rest.soul('bella', OLD_BELLA)
    await migrateBot(deps, 'bella')
    await deps.store.remove('bella')
    await migrateBot(deps, 'bella')
    expect(await backups()).toEqual(['bella-2026-11-12-2.md', 'bella-2026-11-12.md'])
  })

  it('a failed Soul write leaves no record and the next run retries', async () => {
    rest.soul('bella', OLD_BELLA)
    rest.routes.set('PUT /api/profiles/bella/soul', () => { throw new Error('disk full') })
    expect(await migrateBot(deps, 'bella')).toBe('failed')
    expect(deps.store.get('bella')).toBeUndefined()
    rest.routes.delete('PUT /api/profiles/bella/soul')
    expect(await migrateBot(deps, 'bella')).toBe('migrated')
  })

  it('a failed backup stops before any write', async () => {
    rest.soul('bella', OLD_BELLA)
    // A backup folder under a plain file cannot be made (ENOTDIR).
    await writeFile(join(dir, 'not-a-dir'), 'x')
    deps = { ...(await makeDeps()), backupDir: join(dir, 'not-a-dir', 'soul-backups') }
    expect(await migrateBot(deps, 'bella')).toBe('failed')
    expect(rest.writes()).toEqual([])
    expect(rest.souls.get('bella')).toBe(OLD_BELLA)
  })

  it('re-runs a bot whose record is current but whose Soul lost the house block', async () => {
    rest.soul('bella', OLD_BELLA)
    await migrateBot(deps, 'bella')
    rest.soul('bella', 'Edited elsewhere, block gone')
    expect(await migrateBot(deps, 'bella')).toBe('migrated')
    expect(rest.souls.get('bella')).toBe(composeSoul('Edited elsewhere, block gone'))
  })
})

describe('migrateAll', () => {
  it('includes the primary in all scope and only e2e bots in e2e scope', async () => {
    for (const bot of ['default', 'e2e1']) {
      rest.configs.set(bot, {})
      rpc.meta(bot, { title: bot }, 1)
    }
    await migrateAll(deps, ['default', 'e2e1'])
    expect(rest.souls.get('default')).toContain(HOUSE_OPEN)
    expect(rest.souls.get('e2e1')).toContain(HOUSE_OPEN)
    expect(events).toEqual(['now:default', 'now:e2e1'])
  })
})
