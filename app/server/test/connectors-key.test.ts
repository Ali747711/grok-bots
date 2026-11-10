import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { KEY_RE, KeyStore } from '../src/connectors/key.js'
import { setLogSink } from '../src/log.js'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'crew-key-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('KeyStore', () => {
  it('starts unset without a file and reads a saved key trimmed', async () => {
    const file = join(dir, 'k', 'composio-key')
    expect((await KeyStore.load(file)).get()).toBeNull()
    await mkdir(join(dir, 'k'))
    await writeFile(file, '  ak_test_key_123 \n')
    expect((await KeyStore.load(file)).get()).toBe('ak_test_key_123')
    expect(KEY_RE.test('ak_test_key_123')).toBe(true)
    expect(KEY_RE.test('short')).toBe(false)
    expect(KEY_RE.test('has space in it')).toBe(false)
  })

  it('saves atomically with mode 0600 and removes the file', async () => {
    const file = join(dir, 'sub', 'composio-key')
    const store = await KeyStore.load(file)
    await store.save('ak_test_key_123')
    expect(store.get()).toBe('ak_test_key_123')
    expect(await readFile(file, 'utf8')).toBe('ak_test_key_123\n')
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect(await readdir(join(dir, 'sub'))).toEqual(['composio-key'])
    await store.remove()
    await store.remove()
    expect(store.get()).toBeNull()
    expect(await readdir(join(dir, 'sub'))).toEqual([])
  })

  it('treats an unreadable key file as unset and logs only the code', async () => {
    const file = join(dir, 'composio-key')
    await mkdir(file)
    const lines: string[] = []
    const restore = setLogSink(l => lines.push(l))
    try {
      expect((await KeyStore.load(file)).get()).toBeNull()
    } finally {
      restore()
    }
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toMatchObject({ level: 'error', msg: 'composio key unreadable', code: 'EISDIR' })
    expect(lines[0]).not.toContain(dir)
  })
})
