import { useCallback, useEffect, useId, useRef, useState } from 'react'

import { Section, Switch } from '@/components/console/fields'
import { cn } from '@/lib/utils'

import { type ToolsetView, getToolsets, profileErrorText, sandboxLockText, setToolset } from './profile-api'
import { Note, PrimaryReason, ReadError, RowError, RowNotice } from './RowNotes'
import { toolsetCopy, toolsetIcon } from './toolset-copy'
import { useProfileRowAction } from './use-profile-row-action'

interface SkillsTabProps {
  /** The bot's handle. */
  name: string
  title: string
  isPrimary: boolean
}

/** What turning a toolset off costs, said on its row while it is off. */
const OFF_WARNING: Readonly<Record<string, (title: string) => string>> = {
  terminal: () => 'Most work needs this, including approvals and many routines.',
  computer_use: title => `Without it, ${title} can't act on its screen.`
}

/** The bot's toolsets as Hermes has them. A failed read keeps the last rows and says why; `reload` never rejects and resolves false then. */
function useToolsets(name: string) {
  const [views, setViews] = useState<readonly ToolsetView[] | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const reload = useCallback(async (): Promise<boolean> => {
    try {
      const next = await getToolsets(name)
      // An older server or a proxy can answer 200 with another shape.
      if (!Array.isArray(next)) throw new Error('unexpected answer')
      if (alive.current) {
        setViews(next)
        setReadError(null)
      }
      return true
    } catch (e) {
      if (alive.current) setReadError(profileErrorText(e, { read: true }))
      return false
    }
  }, [name])

  /** Shows what a write answered: every row, or only the changed switch when the answer carries no rows. */
  const written = useCallback((answer: readonly ToolsetView[], toolset: string, enabled: boolean) => {
    if (!alive.current) return
    setViews(previous => (Array.isArray(answer) ? answer : (previous?.map(v => (v.name === toolset ? { ...v, enabled } : v)) ?? previous)))
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])
  return { views, readError, reload, written }
}

interface SkillRowProps {
  bot: string
  title: string
  view: ToolsetView
  readOnly: boolean
  reload: () => Promise<boolean>
  onWritten: (answer: readonly ToolsetView[], toolset: string, enabled: boolean) => void
}

/** One toolset: what it is, its switch, and under it whatever holds or warns. Its write and its error are its own. */
function SkillRow({ bot, title, view, readOnly, reload, onWritten }: SkillRowProps) {
  const { pending, error, notice, run } = useProfileRowAction({ title, reload })
  const hintId = useId()
  const { label, description } = toolsetCopy(view)
  const Icon = toolsetIcon(view.name)
  const held = readOnly || pending || view.locked !== undefined
  const lock = sandboxLockText(title)
  const warning = view.enabled ? undefined : OFF_WARNING[view.name]?.(title)
  const toggle = (enabled: boolean) => {
    if (!held) void run(async () => onWritten(await setToolset(bot, view.name, enabled), view.name, enabled))
  }
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3 rounded-2xl bg-shell py-2 pr-3 pl-2">
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full bg-raised transition-colors', view.enabled ? 'text-foreground' : 'text-muted-foreground')}>
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold">{label}</p>
          {description && <p id={hintId} className="text-xs font-medium text-muted-foreground">{description}</p>}
        </div>
        <Switch label={label} checked={view.enabled} disabled={held} onChange={toggle} {...(description ? { describedBy: hintId } : {})} />
      </div>
      {error && <RowError>{error}</RowError>}
      {notice && <RowNotice>{notice}</RowNotice>}
      {/* A refused change already says the lock; it is not said twice. */}
      {view.locked && error !== lock && <Note>{lock}</Note>}
      {view.needsSetup && <Note>Needs setup in Hermes</Note>}
      {warning && <Note>{warning}</Note>}
    </li>
  )
}

/**
 * What the bot can do: Hermes's toolsets, one switch each. A change is saved at once and reaches the
 * bot from its next turn. Read-only for the primary bot: new bots copy its config.
 */
export function SkillsTab({ name, title, isPrimary }: SkillsTabProps) {
  const { views, readError, reload, written } = useToolsets(name)
  return (
    <Section title="Skills" hint={`Applies from ${title}'s next message.`}>
      {isPrimary && <PrimaryReason title={title} />}
      {readError && <ReadError reason={readError} />}
      {views && (
        <ul className="flex flex-col gap-1.5">
          {views.map(view => <SkillRow key={view.name} bot={name} title={title} view={view} readOnly={isPrimary} reload={reload} onWritten={written} />)}
        </ul>
      )}
    </Section>
  )
}
