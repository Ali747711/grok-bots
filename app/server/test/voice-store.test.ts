import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import { setLogSink } from '../src/log.js'
import { VoiceStore } from '../src/voice/voice-store.js'

let file: string
beforeEach(async () => {
  file = join(await mkdtemp(join(tmpdir(), 'crew-voice-')), 'nested', 'voice.json')
})

describe('VoiceStore', () => {
  it('round-trips records in a 0600 file', async () => {
    const store = await VoiceStore.load(file)
    expect(store.get('scout')).toBeUndefined()
    await store.set('scout', { resetPending: true })
    await store.set('scout', { soulVersion: 1 })
    expect(store.get('scout')).toEqual({ resetPending: true, soulVersion: 1 })
    expect((await VoiceStore.load(file)).get('scout')).toEqual({ resetPending: true, soulVersion: 1 })
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    await store.remove('scout')
    expect((await VoiceStore.load(file)).get('scout')).toBeUndefined()
  })

  it('survives a corrupt file with a warning', async () => {
    await (await VoiceStore.load(file)).set('a', { soulVersion: 1 })
    await writeFile(file, '{')
    const lines: string[] = []
    const restore = setLogSink(l => lines.push(l))
    try {
      expect((await VoiceStore.load(file)).get('a')).toBeUndefined()
    } finally {
      restore()
    }
    expect(lines.filter(l => JSON.parse(l).level === 'warn')).toHaveLength(1)
  })

  it('serial writes keep both', async () => {
    const store = await VoiceStore.load(file)
    await Promise.all([store.set('a', { soulVersion: 1 }), store.set('b', { resetPending: true })])
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ bots: { a: { soulVersion: 1 }, b: { resetPending: true } } })
  })
})
