import { randomUUID } from 'node:crypto'
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ConnectorStore, hashToken, loadConnectorStore, tokenMatches, type BotRecord } from '../src/connectors/store.js'
import { setLogSink } from '../src/log.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function record(token: string, over: Partial<BotRecord> = {}): BotRecord {
  return {
    apps: { github: 'read' }, counts: { github: { tools: 2, capped: false } }, sessionId: 'sess_1',
    mcpUrl: 'https://backend.composio.dev/tool_router/sess_1/mcp', allowed: ['G1', 'G2'], tokenHash: hashToken(token), ...over
  }
}

describe('ConnectorStore', () => {
  let dir: string
  let file: string
  let lines: string[]
  let restore: () => void
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'connectors-'))
    file = join(dir, 'connectors.json')
    lines = []
    restore = setLogSink(l => lines.push(l))
  })
  afterEach(async () => {
    restore()
    await rm(dir, { recursive: true, force: true })
  })

  it('creates and persists one userId on first load', async () => {
    const store = await ConnectorStore.load(file, randomUUID)
    expect(store.userId()).toMatch(UUID)
    expect(JSON.parse(await readFile(file, 'utf8')).userId).toBe(store.userId())
    const again = await ConnectorStore.load(file, () => 'ffffffff-ffff-4fff-8fff-ffffffffffff')
    expect(again.userId()).toBe(store.userId())
  })

  it('writes 0600 atomically and reloads the same records, names and sign-ins', async () => {
    const store = await ConnectorStore.load(file, randomUUID)
    await store.setRecord('alpha', record('t1'))
    await store.setToolkit('github', { fetchedAt: 5, tools: [{ slug: 'G1', readOnly: true, destructive: false }] })
    await store.setName('github', 'GitHub')
    await store.addPending({ id: 'ca_1', toolkit: 'github', startedAt: 9 })
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect((await readdir(dir)).filter(f => f.endsWith('.tmp'))).toEqual([])
    const again = await ConnectorStore.load(file, randomUUID)
    expect(again.bots()).toEqual(['alpha'])
    expect(again.record('alpha')).toEqual(record('t1'))
    expect(again.toolkit('github')?.tools).toHaveLength(1)
    expect(again.name('github')).toBe('GitHub')
    expect(again.pending()).toEqual([{ id: 'ca_1', toolkit: 'github', startedAt: 9 }])
    await again.removePending('ca_1')
    await again.deleteRecord('alpha')
    const last = await ConnectorStore.load(file, randomUUID)
    expect(last.pending()).toEqual([])
    expect(last.record('alpha')).toBeUndefined()
  })

  it('stores only the SHA-256 of a token, never the token', async () => {
    const token = 'tok-secret-value-123'
    const store = await ConnectorStore.load(file, randomUUID)
    await store.setRecord('alpha', record(token))
    const text = await readFile(file, 'utf8')
    expect(text).not.toContain(token)
    expect(text).toContain(hashToken(token))
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/)
  })

  it("matches the right token and refuses a wrong, missing or other bot's token", async () => {
    const store = await ConnectorStore.load(file, randomUUID)
    await store.setRecord('alpha', record('right'))
    await store.setRecord('beta', record('other'))
    expect(tokenMatches(store.record('alpha'), 'right')).toBe(true)
    expect(tokenMatches(store.record('alpha'), 'wrong')).toBe(false)
    expect(tokenMatches(store.record('alpha'), 'other')).toBe(false)
    expect(tokenMatches(store.record('alpha'), null)).toBe(false)
    expect(tokenMatches(undefined, 'right')).toBe(false)
    expect(tokenMatches(undefined, null)).toBe(false)
  })

  it('moves a corrupt file aside and keeps a valid userId from it', async () => {
    const id = randomUUID()
    await writeFile(file, JSON.stringify({ version: 1, userId: id, bots: 'nope' }))
    const store = await ConnectorStore.load(file, () => 'ffffffff-ffff-4fff-8fff-ffffffffffff')
    expect(store.userId()).toBe(id)
    expect(store.bots()).toEqual([])
    expect((await readdir(dir)).some(f => /^connectors\.json\.corrupt-\d+$/.test(f))).toBe(true)
    expect(lines.filter(l => JSON.parse(l).level === 'error')).toHaveLength(1)
    expect(JSON.parse(await readFile(file, 'utf8')).userId).toBe(id)

    await writeFile(file, '{nope')
    const fresh = await ConnectorStore.load(file, () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    expect(fresh.userId()).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    await writeFile(file, JSON.stringify({ version: 1, userId: 'default', bots: 1 }))
    const noDefault = await ConnectorStore.load(file, () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    expect(noDefault.userId()).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
  })

  it('serializes concurrent writes so the last mutation wins', async () => {
    const store = await ConnectorStore.load(file, randomUUID)
    await Promise.all([
      store.setRecord('alpha', record('a', { sessionId: 's1' })),
      store.setRecord('alpha', record('a', { sessionId: 's2' })),
      store.setName('github', 'GitHub'),
      store.setRecord('alpha', record('a', { sessionId: 's3' }))
    ])
    const again = await ConnectorStore.load(file, randomUUID)
    expect(again.record('alpha')?.sessionId).toBe('s3')
    expect(again.name('github')).toBe('GitHub')
  })

  it('loadConnectorStore returns null for an unreadable file and logs only the code', async () => {
    await writeFile(file, '{}')
    await chmod(file, 0o000)
    const unreadable = process.getuid?.() === 0 ? join(dir, 'a-directory') : file
    if (unreadable !== file) await (await import('node:fs/promises')).mkdir(unreadable)
    const store = await loadConnectorStore(unreadable, randomUUID)
    expect(store).toBeNull()
    const line = JSON.parse(lines[lines.length - 1] ?? '{}')
    expect(line.level).toBe('error')
    expect(line.code).toMatch(/^E[A-Z]+$/)
    expect(Object.keys(line).sort()).toEqual(['code', 'file', 'level', 'msg', 't'])
  })

  it('never answers a lookup with an Object.prototype member', async () => {
    const store = await ConnectorStore.load(file, randomUUID)
    expect(store.record('constructor')).toBeUndefined()
    expect(store.toolkit('constructor')).toBeUndefined()
    expect(store.name('toString')).toBeUndefined()
    await store.setRecord('constructor', record('t'))
    expect(store.record('constructor')?.apps).toEqual({ github: 'read' })
    expect(store.bots()).toEqual(['constructor'])
  })
})
