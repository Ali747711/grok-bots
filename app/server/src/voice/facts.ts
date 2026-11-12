import type { BotDeps } from '../bots/create.js'
import { readBotDetail } from '../bots/edit.js'
import { readRawConfig } from '../bots/sandbox.js'
import { sandboxStateOf } from '../bots/sandbox-state.js'
import { toolsetViews } from '../bots/toolsets.js'
import type { AppLevel } from '../connectors/levels.js'
import { handleFor } from '../groups/members.js'
import type { GroupsState } from '../groups/types.js'
import { describeSchedule } from '../routines/describe-schedule.js'
import type { RoutineView } from '../routines/service.js'
import type { BotView } from '../watcher/bot-state.js'
import { worklogPath, type RightNowInput } from './right-now.js'

export interface FactsDeps {
  readonly bots: BotDeps
  readonly hermesHome: string
  owner(): { name: string | null; timeZone: string | null }
  roster(): readonly BotView[]
  groups(): GroupsState
  apps(bot: string): readonly { name: string; level: AppLevel }[]
  routines(bot: string): Promise<readonly RoutineView[]>
}

async function enabledToolsets(deps: FactsDeps, bot: string, raw: unknown): Promise<ReadonlySet<string>> {
  const rows = await deps.bots.rest.request<unknown>('GET', '/api/tools/toolsets', { query: { profile: bot } })
  return new Set(toolsetViews(rows, raw).filter(v => v.enabled).map(v => v.name))
}

function routineFacts(routines: readonly RoutineView[]): RightNowInput['routines'] {
  return routines.filter(r => !r.finished).map(r => ({
    title: r.title,
    when: describeSchedule(r.schedule),
    state: r.triggerOnly ? 'triggered' as const : r.enabled ? 'on' as const : 'paused' as const
  }))
}

async function selfFromHermes(deps: FactsDeps, bot: string): Promise<{ title: string; role: string | null; job: string }> {
  const detail = await readBotDetail(deps.bots, bot)
  return { title: detail.title, role: detail.role, job: detail.description }
}

/** Everything the "Right now" block says about one bot, read fresh (spec 2026-11-12 §4.2). */
export async function gatherFacts(deps: FactsDeps, bot: string): Promise<RightNowInput> {
  const raw = await readRawConfig(deps.bots, bot)
  const [toolsets, routines] = await Promise.all([enabledToolsets(deps, bot, raw), deps.routines(bot)])
  const roster = deps.roster()
  // A bot made a moment ago may not be in the roster yet: read its title and job from Hermes then.
  const self = roster.find(b => b.name === bot) ?? await selfFromHermes(deps, bot)
  const sandboxed = sandboxStateOf(raw).state !== 'off'
  return {
    owner: deps.owner(),
    self: { title: self.title, handle: handleFor(bot), role: self.role, job: self.job },
    computer: { on: toolsets.has('computer_use'), sandboxed, browser: toolsets.has('browser') },
    memory: { on: toolsets.has('memory'), worklog: worklogPath(deps.hermesHome, bot, sandboxed) },
    apps: deps.apps(bot),
    routines: routineFacts(routines),
    teammates: roster.filter(b => !b.hidden && b.name !== bot)
      .map(b => ({ title: b.title, handle: handleFor(b.name), role: b.role, job: b.job })),
    groups: deps.groups().rooms.filter(r => r.members.some(m => m.profile === bot)).map(r => ({ name: r.name, purpose: r.purpose }))
  }
}
