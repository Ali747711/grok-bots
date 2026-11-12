import { describe, expect, it } from 'vitest'

import type { BotDeps } from '../src/bots/create.js'
import { setToolset } from '../src/bots/toolsets.js'
import { FakeRest, FakeRpc } from './fake-rpc.js'
import { HIDDEN_TOOLSETS, OFFERED_TOOLSETS, ToolsetShapeError, toolsetViews } from '../src/bots/toolsets.js'
import { failure } from '../src/http/bot-errors.js'

const row = (name: string, extra: Record<string, unknown> = {}) =>
  ({ name, label: `${name} label`, description: `${name} desc`, platform: 'cli', enabled: true, configured: true, ...extra })
const offered = OFFERED_TOOLSETS.map(name => row(name))
const names = (views: readonly { name: string }[]) => views.map(v => v.name)

describe('toolsetViews', () => {
  it('offers the 15 toolsets in a fixed order and hides clarify, connections, stt, kanban, discord, moa, context_engine, video, crew_apps and mcp-*', () => {
    const hidden = ['clarify', 'connections', 'stt', 'kanban', 'discord', 'discord_admin', 'moa', 'context_engine', 'video', 'video_gen', 'yuanbao', 'crew_apps', 'mcp-github'].map(n => row(n))
    const views = toolsetViews([...hidden, ...[...offered].reverse()], {})
    expect(names(views)).toEqual([...OFFERED_TOOLSETS])
    expect(OFFERED_TOOLSETS).toHaveLength(15)
    for (const n of ['clarify', 'connections', 'stt', 'kanban', 'moa', 'context_engine', 'video', 'crew_apps']) expect(HIDDEN_TOOLSETS.has(n)).toBe(true)
  })

  it('shows a plugin or x_search row only when enabled or turned off in agent.disabled_toolsets', () => {
    const rows = [...offered, row('x_search', { enabled: false }), row('a2a', { enabled: false }), row('spotify', { enabled: true })]
    expect(names(toolsetViews(rows, {}))).toEqual([...OFFERED_TOOLSETS, 'spotify'])
    const raw = { agent: { disabled_toolsets: ['x_search'] } }
    const views = toolsetViews(rows, raw)
    expect(names(views)).toEqual([...OFFERED_TOOLSETS, 'x_search', 'spotify'])
    expect(views.find(v => v.name === 'x_search')?.enabled).toBe(false)
    expect(names(views)).not.toContain('a2a')
  })

  it('drops rows for another platform', () => {
    const views = toolsetViews([...offered, row('slackish', { platform: 'discord' }), row('web', { platform: 'discord' })], {})
    expect(names(views)).not.toContain('slackish')
    expect(names(views)).toEqual([...OFFERED_TOOLSETS])
  })

  it('marks needsSetup from configured false and maps label and description', () => {
    const views = toolsetViews([row('web', { configured: false, label: 'Web', description: 'Search' }), row('todo', { label: undefined, description: undefined })], {})
    expect(views[0]).toMatchObject({ name: 'web', label: 'Web', description: 'Search', needsSetup: true, enabled: true })
    expect(views[1]).toMatchObject({ name: 'todo', label: '', description: '', needsSetup: false })
  })

  it('locks browser while the sandbox state is on or partial, not off', () => {
    const rows = [row('browser'), row('web')]
    const find = (raw: unknown) => toolsetViews(rows, raw).find(v => v.name === 'browser')
    expect(find({})?.locked).toBeUndefined()
    expect(find({ terminal: { backend: 'docker' } })?.locked).toBe('sandbox')
    expect(find({ terminal: { backend: 'docker', docker_privileged: true, docker_extra_args: ['--privileged'] }, agent: { disabled_toolsets: ['browser'] } })?.locked).toBe('sandbox')
    expect(toolsetViews(rows, { terminal: { backend: 'docker' } }).find(v => v.name === 'web')?.locked).toBeUndefined()
  })

  it('throws on a bad row shape', () => {
    expect(() => toolsetViews({ nope: 1 }, {})).toThrow(ToolsetShapeError)
    expect(() => toolsetViews([{ label: 'x' }], {})).toThrow(ToolsetShapeError)
    // The parser's own text never travels: the route answers 502 with no message (final review 3).
    const caught = (() => { try { toolsetViews([{ label: 'x' }], {}) } catch (e) { return e } })()
    expect(failure(caught, 'scout')).toEqual({ status: 502, body: { error: 'hermes_error' } })
  })
})

describe('setToolset and the voice service', () => {
  it('tells the voice service after a toolset write', async () => {
    const rest = new FakeRest()
    let memory = true
    rest.routes.set('GET /api/tools/toolsets', () => [{ name: 'memory', enabled: memory, configured: true, platform: 'cli' }])
    rest.configs.set('scout', {})
    const changed: (string | undefined)[] = []
    const deps = { rpc: new FakeRpc().call, rest: { request: rest.request }, refresh: async () => undefined, now: () => 1, voice: { changed: (bot?: string) => { changed.push(bot); memory = false } } } as unknown as BotDeps
    await setToolset(deps, 'scout', 'memory', false)
    expect(changed).toEqual(['scout'])
  })
})
