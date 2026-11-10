import { describe, expect, it } from 'vitest'

import { headerMeta, shortModel } from '@/features/chat/model-name'

import { bot } from './fixtures'

describe('shortModel', () => {
  it('shortens provider/model ids', () => {
    expect(shortModel('anthropic/claude-haiku-5.5')).toBe('claude-haiku-5.5')
    expect(shortModel('openrouter/anthropic/claude-haiku-5.5')).toBe('claude-haiku-5.5')
    expect(shortModel('gpt-5')).toBe('gpt-5')
    expect(shortModel(null)).toBeNull()
  })

  it('treats an empty id, or one that ends in a slash, as no model', () => {
    expect(shortModel('')).toBeNull()
    expect(shortModel('  ')).toBeNull()
    expect(shortModel('anthropic/')).toBeNull()
  })
})

describe('headerMeta', () => {
  const dev = bot({ name: 'dev', role: 'engineer', model: 'anthropic/claude-haiku-5.5' })

  it('joins role, short model and cost', () => {
    expect(headerMeta(dev, 0.12)).toBe('Engineer · claude-haiku-5.5 · ≈ $0.12')
    expect(headerMeta(dev, 0)).toBe('Engineer · claude-haiku-5.5 · ≈ $0.00')
  })

  it('leaves out the parts that are missing', () => {
    expect(headerMeta(dev, null)).toBe('Engineer · claude-haiku-5.5')
    expect(headerMeta({ ...dev, role: null }, 1.5)).toBe('claude-haiku-5.5 · ≈ $1.50')
    expect(headerMeta({ ...dev, model: null }, null)).toBe('Engineer')
    expect(headerMeta(bot({ name: 'x' }), null)).toBe('')
  })
})
