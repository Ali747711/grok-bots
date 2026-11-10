import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { appsErrorText, getBotApps, setBotApps } from '@/features/apps/apps-api'
import type { AppEntry, AppLevel, BotAppsView } from '@/features/apps/apps-types'
import { AppTile } from '@/features/apps/AppTile'
import { openDialog, useKeyChanged } from '@/features/apps/open-dialog'
import { useApps } from '@/features/apps/use-apps'

import { AppsNotes } from './AppsNotes'

const LEVEL_LABEL: Readonly<Record<AppLevel, string>> = { read: 'Read only', change: 'Read and change', all: 'Everything' }
const LEVEL_ORDER: readonly AppLevel[] = ['read', 'change', 'all']

interface Row { toolkit: string; name: string; connected: boolean; known: boolean; entry: AppEntry | undefined }

function levelsMap(view: BotAppsView | null): Record<string, AppLevel> {
  return Object.fromEntries((view?.apps ?? []).map(a => [a.toolkit, a.level]))
}

function AppRow({ row, bot, title, offered, busy, onChange }: {
  row: Row; bot: string; title: string; offered: readonly AppLevel[]; busy: boolean
  onChange: (toolkit: string, level: AppLevel | null) => void
}) {
  const { entry } = row
  const on = entry !== undefined
  // The current level always has an item, so the trigger never shows a blank.
  const levels = LEVEL_ORDER.filter(l => offered.includes(l) || l === entry?.level)
  const items = levels.map(l => ({ value: l, label: LEVEL_LABEL[l] }))
  return (
    <li className="flex flex-col gap-2" data-bot={bot}>
      <div className="flex items-center gap-2 text-sm">
        <AppTile name={row.name} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{row.name}</span>
          {row.known && !row.connected && <span className="text-xs text-muted-foreground">Not connected</span>}
        </div>
        <Switch
          checked={on}
          disabled={busy || (!on && !row.connected)}
          onCheckedChange={next => onChange(row.toolkit, next ? 'read' : null)}
          aria-label={`Let ${title} use ${row.name}`}
          className="data-checked:bg-foreground data-unchecked:border-muted-foreground"
        />
      </div>
      {entry && row.known && row.connected && (
        <Select value={entry.level} items={items} disabled={busy} onValueChange={v => v !== null && v !== entry.level && onChange(row.toolkit, v as AppLevel)}>
          <SelectTrigger aria-label={`${row.name} access`} className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {items.map(i => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {entry?.capped && (
        <p className="text-xs text-muted-foreground">{`${row.name} has more tools than a bot can hold, so only ${entry.tools} are on.`}</p>
      )}
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
  const reload = useCallback(async () => {
    try {
      const next = await getBotApps(bot)
      if (alive.current) setView(next)
    } catch {
      // The list stays as it was; the apps list shows its own error.
    }
  }, [bot])
  useEffect(() => { void reload() }, [reload])
  useKeyChanged(useCallback(() => { void reload() }, [reload]))
  return { view, setView, reload }
}

export function AppsSection({ bot, title, sandboxed }: { bot: string; title: string; sandboxed: boolean }) {
  const { list, error: listError } = useApps()
  const { view, setView, reload } = useBotApps(bot)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

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
    const next = levelsMap(view)
    if (level === null) delete next[toolkit]
    else next[toolkit] = level
    setBusy(true)
    setFailure(null)
    try {
      setView(await setBotApps(bot, next))
      toast.success('Apps updated')
    } catch (e) {
      setFailure(appsErrorText(e))
      await reload()
    }
    setBusy(false)
  }

  const noKey = (view !== null && !view.keyConfigured) || listError === 'no_key' || listError === 'key_rejected'
  const empty = !noKey && list !== null && rows.length === 0
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Apps</h3>
      {noKey && <Button type="button" variant="outline" onClick={() => openDialog('settings')}>Set the key in Settings</Button>}
      {empty && (
        <div className="flex flex-col items-start gap-2 text-sm">
          <span>No apps connected yet.</span>
          <Button type="button" variant="outline" onClick={() => openDialog('apps')}>Open Apps</Button>
        </div>
      )}
      {listError !== null && !noKey && <p role="alert" className="text-sm text-destructive">{listError}</p>}
      {rows.length > 0 && (
        <ul className="flex flex-col gap-3">
          {rows.map(r => (
            <AppRow key={r.toolkit} row={r} bot={bot} title={title} offered={view?.offered ?? ['read']} busy={busy || view === null} onChange={(t, l) => void change(t, l)} />
          ))}
        </ul>
      )}
      {failure && <p role="alert" className="text-sm text-destructive">{failure}</p>}
      <AppsNotes view={view} sandboxed={sandboxed} />
    </section>
  )
}
