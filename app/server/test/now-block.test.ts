import { describe, expect, it } from 'vitest'

import { NOW_CLOSE, NOW_OPEN } from '../src/bots/soul.js'
import { RIGHT_NOW_CARRIER, activePersonality, carrierFor, mergeNowBlock, withoutNowBlock } from '../src/voice/now-block.js'

const block = (text: string) => `${NOW_OPEN}\n## Right now\n${text}\n${NOW_CLOSE}`

describe('mergeNowBlock', () => {
  it.each(['', 'Be brief.', 'a\n\nb\n'])('merge keeps owner text byte-identical and replaces only Crew\'s block (%j)', prompt => {
    const merged = mergeNowBlock(prompt, block('one'))
    expect(withoutNowBlock(merged)).toBe(prompt)
    expect(merged).toContain(block('one'))
    const again = mergeNowBlock(merged, block('two'))
    expect(withoutNowBlock(again)).toBe(prompt)
    expect(again).toContain(block('two'))
    expect(again).not.toContain(block('one'))
  })

  it('appends after owner text with one blank line', () => {
    expect(mergeNowBlock('Be brief.', block('x'))).toBe(`Be brief.\n\n${block('x')}`)
    expect(mergeNowBlock('', block('x'))).toBe(block('x'))
  })

  it('a lone open marker in the owner text never swallows the text after it', () => {
    const owner = 'OWNER1 <!-- crew:now --> OWNER2 must survive'
    const once = mergeNowBlock(owner, block('one'))
    const twice = mergeNowBlock(once, block('two'))
    expect(withoutNowBlock(twice)).toBe(owner)
    expect(twice).toContain('OWNER2 must survive')
    expect(twice.split(block('two')).length - 1).toBe(1)
  })

  it('replaces a cloned block and never duplicates it', () => {
    const cloned = `Owner text\n\n${block('the primary')}\n\n${block('stale copy')}`
    const merged = mergeNowBlock(cloned, block('mine'))
    expect(merged.split(NOW_OPEN).length - 1).toBe(1)
    expect(merged).toContain(block('mine'))
    expect(withoutNowBlock(merged)).toBe('Owner text')
  })
})

describe('personality and carrier', () => {
  const raw = (personality: unknown, extra: Record<string, unknown> = {}) => ({ display: { personality }, agent: { ...extra } })

  it.each([['noir', 'noir'], ['None', ''], ['default', ''], ['madeup', ''], ['mine', 'mine'], ['', '']])('activePersonality %s', (name, expected) => {
    expect(activePersonality(raw(name, { personalities: { mine: 'You are mine.' } }))).toBe(expected)
  })

  it('reads no personality from an empty or odd config', () => {
    expect(activePersonality({})).toBe('')
    expect(activePersonality({ display: 'x' })).toBe('')
    expect(activePersonality(null)).toBe('')
  })

  it('the base carrier is the system prompt (Task 1 live facts)', () => {
    expect(RIGHT_NOW_CARRIER).toBe('system_prompt')
    expect(carrierFor({})).toBe('system_prompt')
  })

  it('a personality or a Soul base sends the bot to the Soul carrier', () => {
    expect(carrierFor(raw('noir'))).toBe('soul')
    expect(carrierFor({}, 'soul')).toBe('soul')
  })

  it('a non-string system_prompt sends the bot to the Soul carrier', () => {
    expect(carrierFor({ agent: { system_prompt: ['x'] } })).toBe('soul')
    expect(carrierFor({ agent: { system_prompt: 'text' } })).toBe('system_prompt')
  })
})
