import { describe, expect, it } from 'vitest'

import { historyToItems, type HistoryRow } from '@/chat/history'

import history from './fixtures/history-rows.json'

const rows = history.messages as unknown as HistoryRow[]

describe('historyToItems (captured rows)', () => {
  const items = historyToItems(rows)

  it('turns stored rows into user, assistant and work items', () => {
    const last = items.slice(-3)
    expect(last.map(i => i.kind)).toEqual(['user', 'work', 'assistant'])
    expect(last[0]).toMatchObject({ kind: 'user', text: 'Run: echo crew-fixture-ok' })
    expect(last[2]).toMatchObject({ kind: 'assistant' })
    expect((last[2] as { text: string }).text).toContain('crew-fixture-ok')
  })

  it('folds a tool call and its result into one step', () => {
    const work = items.slice(-2)[0]
    expect(work?.kind).toBe('work')
    if (work?.kind !== 'work') return
    expect(work.steps).toHaveLength(1)
    expect(work.steps[0]).toMatchObject({ name: 'terminal', summary: 'echo crew-fixture-ok', running: false })
    expect(work.steps[0]?.isError).toBeFalsy()
    expect(work.steps[0]?.detail).toContain('crew-fixture-ok')
  })

  it('marks a blocked tool result as an error', () => {
    const blocked = items.find(i => i.kind === 'work' && i.steps.some(s => s.isError))
    expect(blocked).toBeDefined()
  })

  it('hides scaffold rows (hidden interrupt marker, internal notifications) and keeps no empty items', () => {
    const texts = items.flatMap(i => ('text' in i ? [i.text] : []))
    expect(texts.some(t => t.includes('Message from'))).toBe(false)
    expect(texts.some(t => t.includes('interrupt: no assistant output'))).toBe(false)
    expect(texts.every(t => t.trim().length > 0)).toBe(true)
  })

  it('shows a failed turn as a notice', () => {
    expect(items.some(i => i.kind === 'notice' && i.text.includes('Gateway shutting down'))).toBe(true)
  })

  it('prefers display_content over content', () => {
    const row = { ...rows[0]!, role: 'user', content: 'raw', display_content: 'shown' } as HistoryRow
    expect(historyToItems([row])).toMatchObject([{ kind: 'user', text: 'shown' }])
  })

  it('gives every item a unique id', () => {
    const ids = items.map(i => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
