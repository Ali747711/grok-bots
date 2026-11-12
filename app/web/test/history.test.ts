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

  it('shows relayed bot messages as muted notices attributed by handle', () => {
    const notices = items.filter(i => i.kind === 'notice').map(i => (i as { text: string }).text)
    const relayed = notices.filter(t => t.startsWith('From @hermes: '))
    expect(relayed).toHaveLength(2)
    expect(relayed[0]).toContain('Please run this one shell command')
    expect(relayed.every(t => t.length <= 'From @hermes: '.length + 300)).toBe(true)
  })

  it('truncates an unattributed internal notification to 300 characters', () => {
    const row = { ...rows[0]!, role: 'user', display_kind: 'internal_notification', content: 'x'.repeat(500) } as HistoryRow
    expect(historyToItems([row])).toMatchObject([{ kind: 'notice', text: 'x'.repeat(300) }])
  })

  it('hides scaffold rows (hidden interrupt marker) and keeps no empty items', () => {
    const texts = items.flatMap(i => ('text' in i ? [i.text] : []))
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

  it('stamps history steps from the tool result row, falling back to the assistant row', () => {
    const call = (id: string) => ({ id, function: { name: 'terminal', arguments: '{"command":"ls"}' } })
    const stamped: HistoryRow[] = [
      { id: 1, role: 'assistant', content: '', tool_calls: [call('t1'), call('t2')], timestamp: 1700000000.25 },
      { id: 2, role: 'tool', tool_call_id: 't1', tool_name: 'terminal', content: '{"exit_code":0}', timestamp: 1700000000.5 },
      { id: 3, role: 'tool', tool_call_id: 't2', tool_name: 'terminal', content: '{"exit_code":0}' },
      { id: 4, role: 'tool', tool_call_id: 't3', tool_name: 'terminal', content: '{"exit_code":0}', timestamp: 1700000002 }
    ]
    const [work] = historyToItems(stamped)
    if (work?.kind !== 'work') throw new Error('expected one work item')
    // Seconds as a float become whole milliseconds.
    expect(work.steps.map(s => s.at)).toEqual([1700000000500, 1700000000250, 1700000002000])
  })

  it('leaves a history step without a time when no row carries one', () => {
    const [work] = historyToItems([
      { id: 1, role: 'assistant', content: '', tool_calls: [{ id: 't1', function: { name: 'terminal', arguments: '{}' } }] },
      { id: 2, role: 'tool', tool_call_id: 't1', tool_name: 'terminal', content: 'ok' }
    ])
    if (work?.kind !== 'work') throw new Error('expected one work item')
    expect(work.steps[0]).not.toHaveProperty('at')
  })
})
