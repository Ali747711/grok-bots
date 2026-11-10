import { describe, expect, it } from 'vitest'

import { allowList, allowedSlugs, approvalsAsk, offeredLevels } from '../src/connectors/levels.js'
import type { ToolHint } from '../src/connectors/composio.js'

const R: ToolHint = { slug: 'R', readOnly: true, destructive: false }
const W: ToolHint = { slug: 'W', readOnly: false, destructive: false }
const D: ToolHint = { slug: 'D', readOnly: false, destructive: true }
const X: ToolHint = { slug: 'X', readOnly: false, destructive: true } // no hints: the MCP default is destructive

describe('connector levels', () => {
  it('Read only keeps readOnlyHint tools, Read and change adds non-destructive ones, Everything keeps all', () => {
    const tools = [R, W, D, X]
    expect(allowedSlugs(tools, 'read')).toEqual(['R'])
    expect(allowedSlugs(tools, 'change')).toEqual(['R', 'W'])
    expect(allowedSlugs(tools, 'all')).toEqual(['R', 'W', 'D', 'X'])
  })

  it('lists read-only tools first', () => {
    const r2: ToolHint = { slug: 'R2', readOnly: true, destructive: false }
    expect(allowedSlugs([W, R, D, r2], 'all')).toEqual(['R', 'R2', 'W', 'D'])
  })

  it("caps the bot's allow list across apps and marks the cut app capped", () => {
    const tools: Record<string, ToolHint[]> = {
      slack: [{ ...R, slug: 'S1' }, { ...R, slug: 'S2' }],
      github: [{ ...R, slug: 'G1' }, { ...R, slug: 'G2' }]
    }
    const list = allowList({ slack: 'read', github: 'read' }, t => tools[t] ?? [], 3)
    expect(list.allowed).toEqual(['G1', 'G2', 'S1'])
    expect(list.byApp).toEqual({ github: { tools: 2, capped: false }, slack: { tools: 1, capped: true } })
    expect(allowList({ slack: 'read' }, t => tools[t] ?? [], null).byApp.slack).toEqual({ tools: 2, capped: false })
  })

  it('treats approvals.mode off, OFF and YAML false as not asking; missing, manual and smart as asking', () => {
    for (const raw of ['off', 'OFF', ' Off ', false]) expect(approvalsAsk(raw)).toBe(false)
    for (const raw of [undefined, null, 'manual', 'smart', true, 0]) expect(approvalsAsk(raw)).toBe(true)
  })

  it('offers only Read only when the bot does not ask, and only what the policy allows', () => {
    expect(offeredLevels(true)).toEqual(['read', 'change', 'all'])
    expect(offeredLevels(false)).toEqual(['read'])
    expect(offeredLevels(true, ['read', 'change'])).toEqual(['read', 'change'])
    expect(offeredLevels(false, ['change'])).toEqual([])
  })
})
