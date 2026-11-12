import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { ChoiceChips, type Option, Section, Switch } from '@/components/console/fields'
import { Button } from '@/components/ui/button'
import { getBotApps, setBotApps } from '@/features/apps/apps-api'
import type { AppEntry, AppLevel, BotAppsView } from '@/features/apps/apps-types'
import { AppTile } from '@/features/apps/AppTile'
import { openDialog, useKeyChanged } from '@/features/apps/open-dialog'
import { useApps } from '@/features/apps/use-apps'
import { Note, RowError, RowNotice } from '@/features/profile/RowNotes'
import { useProfileRowAction } from '@/features/profile/use-profile-row-action'

import { AppsNotes } from './AppsNotes'

const LEVEL_LABEL: Readonly<Record<AppLevel, string>> = { read: 'Read only', change: 'Read and change', all: 'Everything' }
const LEVEL_ORDER: readonly AppLevel[] = ['read', 'change', 'all']

interface Row { toolkit: string; name: string; connected: boolean; known: boolean; entry: AppEntry | undefined }

function levelsMap(view: BotAppsView | null): Record<string, AppLevel> {
  return Object.fromEntries((view?.apps ?? []).map(a => [a.toolkit, a.level]))
}

interface AppRowProps {
  row: Row
  bot: string
  title: string
  offered: readonly AppLevel[]
  busy: boolean
  /** Why the last change to this app failed. */
  error: string | null
  /** The last change to this app was saved but could not be read back. */
  notice: string | null
  onChange: (toolkit: string, level: AppLevel | null) => void
}

/** One app: its switch, its level as chips once it is on and connected, and what failed or was capped. */
function AppRow({ row, bot, title, offered, busy, error, notice, onChange }: AppRowProps) {
  const { entry } = row
  const on = entry !== undefined
  // The current level always has a chip, so the group never shows nothing chosen.
  const levels: Option<AppLevel>[] = LEVEL_ORDER.filter(l => offered.includes(l) || l === entry?.level).map(l => ({ value: l, label: LEVEL_LABEL[l] }))
  return (
    <li className="flex flex-col gap-1.5" data-bot={bot}>
      <div className="flex items-center gap-3 rounded-2xl bg-shell py-2 pr-3 pl-2">
        {/* `data-private`: the committed screenshots mask which apps the user connected. */}
        <span data-private="app" className="flex shrink-0"><AppTile name={row.name} /></span>
        <div data-private="app" className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] font-semibold">{row.name}</span>
          {row.known && !row.connected && <span className="text-xs font-medium text-muted-foreground">Not connected</span>}
        </div>
        <Switch
          checked={on}
          disabled={busy || (!on && !row.connected)}
          onChange={next => onChange(row.toolkit, next ? 'read' : null)}
          label={`Let ${title} use ${row.name}`}
        />
      </div>
      {entry && row.known && row.connected && (
        <ChoiceChips
          legend={`${row.name} access`} value={entry.level} options={levels} disabled={busy}
          onChange={level => {
            if (level !== entry.level) onChange(row.toolkit, level)
          }}
        />
      )}
      {error && <RowError>{error}</RowError>}
      {notice && <RowNotice>{notice}</RowNotice>}
      {entry?.capped && <Note>{`${row.name} has more tools than a bot can hold, so only ${entry.tools} are on.`}</Note>}
    </li>
  )
}

function useBotApps(bot: string) {
  const [view, setView] = useState<BotAppsView | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  /** Resolves false when the apps could not be read: the list stays as it was. */
  const reload = useCallback(async (): Promise<boolean> => {
    try {
      const next = await getBotApps(bot)
      if (alive.current) setView(next)
      return true
    } catch {
      // The list stays as it was; a row that just wrote says it could not be re-checked.
      return false
    }
  }, [bot])
  useEffect(() => { void reload() }, [reload])
  useKeyChanged(useCallback(() => { void reload() }, [reload]))
  return { view, setView, reload }
}

/**
 * The apps a bot may use and how far: one switch per app and its level as chips. A change applies at
 * once. One write carries every app's level, so every row waits while it runs; a failure is said on
 * the row that was changed.
 */
export function AppsSection({ bot, title, sandboxed }: { bot: string; title: string; sandboxed: boolean }) {
  const { list, error: listError } = useApps()
  const { view, setView, reload } = useBotApps(bot)
  const { pending, error, notice, run } = useProfileRowAction({ title, reload })
  const [changed, setChanged] = useState<string | null>(null)

  const rows = useMemo<Row[]>(() => {
    const connected = new Map((list?.apps ?? []).filter(a => a.status === 'connected').map(a => [a.toolkit, a.name]))
    const bySlug = new Map((view?.apps ?? []).map(a => [a.toolkit, a]))
    const slugs = [...new Set([...connected.keys(), ...bySlug.keys()])]
    return slugs.map(toolkit => ({
      toolkit,
      name: connected.get(toolkit) ?? bySlug.get(toolkit)?.name ?? toolkit,
      connected: connected.has(toolkit),
      known: list !== null,
      entry: bySlug.get(toolkit)
    }))
  }, [list, view])

  const change = async (toolkit: string, level: AppLevel | null) => {
    if (pending) return
    const { [toolkit]: _dropped, ...rest } = levelsMap(view)
    const next = level === null ? rest : { ...rest, [toolkit]: level }
    setChanged(toolkit)
    if (await run(async () => setView(await setBotApps(bot, next)))) toast.success('Apps updated')
  }

  const noKey = (view !== null && !view.keyConfigured) || listError === 'no_key' || listError === 'key_rejected'
  const empty = !noKey && list !== null && rows.length === 0
  // A failure whose row is gone is still said, under the list.
  const orphan = !rows.some(r => r.toolkit === changed)
  const orphanError = error !== null && orphan
  return (
    <Section title="Apps">
      {noKey && <Button type="button" variant="outline" className="self-start" onClick={() => openDialog('settings')}>Set the key in Settings</Button>}
      {empty && (
        <div className="flex flex-col items-start gap-2 px-1 text-[13px] font-medium">
          <span>No apps connected yet.</span>
          <Button type="button" variant="outline" onClick={() => openDialog('apps')}>Open Apps</Button>
        </div>
      )}
      {listError !== null && !noKey && <RowError>{listError}</RowError>}
      {rows.length > 0 && (
        <ul className="flex flex-col gap-2.5">
          {rows.map(r => (
            <AppRow
              key={r.toolkit} row={r} bot={bot} title={title} offered={view?.offered ?? ['read']} busy={pending || view === null}
              error={r.toolkit === changed ? error : null} notice={r.toolkit === changed ? notice : null} onChange={(t, l) => void change(t, l)}
            />
          ))}
        </ul>
      )}
      {orphanError && <RowError>{error}</RowError>}
      {notice !== null && orphan && <RowNotice>{notice}</RowNotice>}
      <AppsNotes view={view} sandboxed={sandboxed} />
    </Section>
  )
}
