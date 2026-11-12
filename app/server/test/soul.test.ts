import { describe, expect, it } from 'vitest'

import { HOUSE_CLOSE, HOUSE_OPEN, NOW_CLOSE, NOW_OPEN, composeSoul, hasHouseBlock, houseBlock, newOwnerPart, nowOf, ownerPartOf } from '../src/bots/soul.js'
import { HOUSE_TEXT } from '../src/voice/copy.js'

const NOW = `${NOW_OPEN}\n## Right now\n- You: Scout\n${NOW_CLOSE}`

describe('house block', () => {
  it('keeps the house block within 3,000 characters and free of names', () => {
    expect(houseBlock().length).toBeLessThanOrEqual(3000)
    expect(houseBlock()).not.toContain('Hermes')
    expect(houseBlock()).not.toContain('{')
    expect(houseBlock().startsWith(`${HOUSE_OPEN}\n${HOUSE_TEXT}`)).toBe(true)
    expect(houseBlock().endsWith(HOUSE_CLOSE)).toBe(true)
  })

  it('carries the voice, honesty and memory rules', () => {
    expect(HOUSE_TEXT).toContain('talk like a warm, clear friend')
    expect(HOUSE_TEXT).toContain('say "done" only after you\'ve checked it')
    expect(HOUSE_TEXT).toContain('Never probe the system')
  })
})

describe('owner part', () => {
  it('builds a new owner part from title and mission, no template sentences', () => {
    expect(newOwnerPart({ name: 'scout', title: 'Researcher', mission: 'Find papers' })).toBe('# Researcher\n\n**Mission:** Find papers')
    expect(newOwnerPart({ name: 'scout', title: '', mission: '' })).toBe('# Scout')
    expect(newOwnerPart({ name: 'inbox-triage', title: '', mission: '' })).toBe('# Inbox Triage')
  })

  it.each(['', 'a', 'a\n', 'a\n\n', '# T\n\n**Mission:** x'])('round-trips the owner part %j', owner => {
    expect(ownerPartOf(composeSoul(owner))).toBe(owner)
  })

  it('composes the owner part, one blank line, the house block and a final newline', () => {
    expect(composeSoul('mine')).toBe(`mine\n\n${houseBlock()}\n`)
    expect(composeSoul('')).toBe(`${houseBlock()}\n`)
  })

  it('keeps text around a lone open marker and drops only complete blocks', () => {
    const owner = `x\n${HOUSE_OPEN}\ny`
    const soul = composeSoul(owner)
    expect(ownerPartOf(soul)).toBe(owner)
    expect(ownerPartOf(`${owner}\n\n${houseBlock()}\nafter`)).toBe(`${owner}\nafter`)
  })

  it('two house blocks become one', () => {
    const doubled = `a\n\n${houseBlock()}\n\n${houseBlock()}\n`
    const once = composeSoul(ownerPartOf(doubled))
    expect(once.split(HOUSE_OPEN).length - 1).toBe(1)
    expect(ownerPartOf(once)).toBe('a')
  })

  it('strips a block of any version', () => {
    const old = 'mine\n\n<!-- crew:house v7 -->\nold rules\n<!-- /crew:house -->\n'
    expect(ownerPartOf(old)).toBe('mine')
    expect(hasHouseBlock(old)).toBe(false)
    expect(hasHouseBlock(old, 7)).toBe(true)
    expect(hasHouseBlock(composeSoul('mine'))).toBe(true)
  })

  it('puts a now block inside the house area and reads it back', () => {
    const soul = composeSoul('o', NOW)
    expect(nowOf(soul)).toBe(NOW)
    expect(ownerPartOf(soul)).toBe('o')
    expect(soul.indexOf(NOW)).toBeGreaterThan(soul.indexOf(HOUSE_OPEN))
    expect(soul.indexOf(NOW)).toBeLessThan(soul.indexOf(HOUSE_CLOSE))
    expect(nowOf(composeSoul('o'))).toBeNull()
  })
})
