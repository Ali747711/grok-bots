import { NOW_CLOSE, NOW_OPEN } from '../bots/soul.js'
import type { AppLevel } from '../connectors/levels.js'

/** Cap on the whole block, markers included (spec 2026-11-12 §3 anti-goals). */
export const RIGHT_NOW_MAX = 1500
const ITEM_MAX = 120
const JOB_MAX = 200

export interface RightNowInput {
  readonly owner: { readonly name: string | null; readonly timeZone: string | null }
  readonly self: { readonly title: string; readonly handle: string; readonly role: string | null; readonly job: string }
  /** `browser`: the browser toolset is on (Crew turns it off in the sandbox: its Python runs on the host). */
  readonly computer: { readonly on: boolean; readonly sandboxed: boolean; readonly browser: boolean }
  readonly memory: { readonly on: boolean; readonly worklog: string }
  readonly apps: readonly { readonly name: string; readonly level: AppLevel }[]
  readonly routines: readonly { readonly title: string; readonly when: string; readonly state: 'on' | 'paused' | 'triggered' }[]
  readonly teammates: readonly { readonly title: string; readonly handle: string; readonly role: string | null; readonly job: string }[]
  readonly groups: readonly { readonly name: string; readonly purpose: string }[]
}

const LEVEL_WORDS: Record<AppLevel, string> = { read: 'read only', change: 'read and change', all: 'full access' }
const ROUTINE_STATE: Record<'on' | 'paused' | 'triggered', string> = { on: 'on', paused: 'paused', triggered: 'runs when triggered' }

/**
 * One line of user text, cut with '…' on code points (never inside an emoji). Angle brackets are dropped,
 * so no value can form a comment marker and open or close a Crew block, however it is nested.
 */
export function oneLine(value: string, max: number): string {
  const flat = [...value.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim()]
  return flat.length <= max ? flat.join('') : `${flat.slice(0, max - 1).join('').trimEnd()}…`
}

/** Where the bot keeps its dated work log: local bots share one HOME, so it lives in the profile folder. */
export function worklogPath(hermesHome: string, bot: string, sandboxed: boolean): string {
  if (sandboxed) return '/workspace/worklog.md'
  return bot === 'default' ? `${hermesHome}/worklog.md` : `${hermesHome}/profiles/${bot}/worklog.md`
}

const item = (value: string) => oneLine(value, ITEM_MAX)

function ownerLine({ name, timeZone }: RightNowInput['owner']): string {
  const zone = timeZone ? item(timeZone) : null
  if (name) return zone ? `Owner: ${item(name)}, time zone ${zone}.` : `Owner: ${item(name)}.`
  return `Owner: name not set yet; if they tell you, remember it.${zone ? ` Time zone ${zone}.` : ''}`
}

function youLine({ title, handle, role, job }: RightNowInput['self']): string {
  const jobText = oneLine(job, JOB_MAX)
  return `You: ${item(title)} (@${item(handle)})${role ? `, ${item(role)}` : ''}.${jobText ? ` Job: ${jobText}` : ''}`
}

function computerLine({ on, sandboxed, browser }: RightNowInput['computer']): string {
  if (!on) return 'Computer: you have no computer right now.'
  const base = 'Computer: you have your own computer with a screen; use it for anything a person would do on a desktop.'
  if (!sandboxed) return base
  const own = `${base} It's a sandboxed computer, separate from your owner's machine, so keep anything you need later in /workspace.`
  return browser ? own : `${own} Your browser opens on your screen when the screen starts (the round logo on the dock opens another); use it the way a person would. The screen is yours alone: when a click or typing step says to retry it in the foreground, retry it in the foreground.`
}

function memoryLine({ on, worklog }: RightNowInput['memory']): string {
  if (!on) return "Memory: off, so you can't save notes. Say so if the owner asks you to remember something."
  return `Memory: on. Your work log is ${worklog}; add one dated line per finished job (create the file if it's missing).`
}

interface ListSection { readonly label: string; readonly empty: string; readonly items: readonly string[] }

function listSections(input: RightNowInput): ListSection[] {
  const mate = (m: RightNowInput['teammates'][number]) =>
    `${item(m.title)} (@${item(m.handle)})${m.role ? `: ${item(m.role)}` : ''}${m.job ? `, ${item(m.job)}` : ''}`
  return [
    { label: 'Apps', empty: "none connected. Only your owner can connect apps, from Crew's Apps.", items: input.apps.map(a => `${item(a.name)}: ${LEVEL_WORDS[a.level]}`) },
    { label: 'Routines', empty: 'none.', items: input.routines.map(r => `${item(r.title)}, ${item(r.when)}, ${ROUTINE_STATE[r.state]}`) },
    { label: 'Teammates', empty: 'none.', items: input.teammates.map(mate) },
    { label: "Groups you're in", empty: 'none.', items: input.groups.map(g => `${item(g.name)}${g.purpose ? `: ${item(g.purpose)}` : ''}`) }
  ]
}

function renderList(section: ListSection, shown: number): string {
  if (section.items.length === 0) return `${section.label}: ${section.empty}`
  const hidden = section.items.length - shown
  return `${section.label}: ${section.items.slice(0, shown).join('; ')}${hidden > 0 ? `; and ${hidden} more` : ''}`
}

/** The "Right now" block. Owner, You, Computer and Memory are never cut; the longest list loses items first. */
export function buildRightNow(input: RightNowInput): string {
  const fixed = [ownerLine(input.owner), youLine(input.self), computerLine(input.computer), memoryLine(input.memory)]
  const sections = listSections(input)
  const shown = sections.map(s => s.items.length)
  const render = () => [NOW_OPEN, '## Right now', ...fixed, ...sections.map((s, i) => renderList(s, shown[i]!)), NOW_CLOSE].join('\n')
  let block = render()
  while (block.length > RIGHT_NOW_MAX) {
    const lines = sections.map((s, i) => (shown[i]! > 0 ? renderList(s, shown[i]!).length : -1))
    const longest = lines.indexOf(Math.max(...lines))
    if (longest < 0 || lines[longest]! < 0) break
    shown[longest] = shown[longest]! - 1
    block = render()
  }
  return block
}
