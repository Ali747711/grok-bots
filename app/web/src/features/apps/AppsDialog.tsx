import { useState } from 'react'

import { DIALOG_DESCRIPTION, DIALOG_TITLE, ERROR_TEXT, WELL } from '@/components/console/dialog-styles'
import { Button } from '@/components/ui/button'
import { type PillTone, StatusPill } from '@/features/routines/StatusPill'
import type { BotView } from '@/state/types'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

import type { ConnectedApp } from './apps-types'
import { AppTile } from './AppTile'
import { ConnectApp } from './ConnectApp'
import { DisconnectApp } from './DisconnectApp'
import { openDialog } from './open-dialog'
import { useApps } from './use-apps'

const STATUS: Record<ConnectedApp['status'], { text: string; tone: PillTone }> = {
  connected: { text: 'Connected', tone: 'ok' },
  pending: { text: 'Waiting for sign-in…', tone: 'warn' },
  failed: { text: 'Not connected', tone: 'error' }
}
const NOTE = 'px-1 text-[13px] font-medium text-muted-foreground'

function KeyProblem({ error, onSettings }: { error: string; onSettings: () => void }) {
  return (
    <div className={`${WELL} flex flex-col items-start gap-3 p-4 text-[13px] font-medium`}>
      <p>{error === 'no_key' ? 'No Composio key yet.' : 'Key not accepted'}</p>
      <Button type="button" size="sm" variant="outline" onClick={onSettings}>Set the key in Settings</Button>
    </div>
  )
}

interface AppsDialogProps { open: boolean; onOpenChange: (open: boolean) => void; bots?: readonly BotView[] }

export function AppsDialog({ open, onOpenChange, bots = [] }: AppsDialogProps) {
  // Mounted only while open, so the list is read fresh each time.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] gap-5 overflow-y-auto">
        <DialogHeader>
          <DialogTitle className={DIALOG_TITLE}>Apps</DialogTitle>
          <DialogDescription className={DIALOG_DESCRIPTION}>Apps your bots can use, through Composio.</DialogDescription>
        </DialogHeader>
        {open && <AppsBody bots={bots} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

/** Another connected account of the same app keeps it working for the bots. */
const sibling = (apps: readonly ConnectedApp[], app: ConnectedApp) =>
  apps.some(a => a.id !== app.id && a.toolkit === app.toolkit && a.status === 'connected')

function AppsBody({ bots, onClose }: { bots: readonly BotView[]; onClose: () => void }) {
  const { list, error, reload } = useApps()
  const [connecting, setConnecting] = useState(false)
  if (error === 'no_key' || error === 'key_rejected') // Apps closes first, so Settings never stacks on top of it.
    return <KeyProblem error={error} onSettings={() => { onClose(); openDialog('settings') }} />
  if (error) return <p role="alert" className={ERROR_TEXT}>{error}</p>
  if (!list) return <p className={NOTE}>Loading apps…</p>
  return (
    <div className="flex flex-col gap-4">
      {list.apps.length === 0 && <p className={`${WELL} px-4 py-6 text-center text-[13px] font-medium text-muted-foreground`}>No apps connected yet.</p>}
      <ul className="m-0 flex list-none flex-col gap-1 p-0 empty:hidden">
        {list.apps.map(app => (
          // `data-app` covers the whole row: the visual check masks it, because the list is the user's own apps.
          <li key={app.id} data-app={app.toolkit} className="flex min-h-12 items-center gap-2.5 rounded-3xl bg-background py-1.5 pr-1.5 pl-2">
            <AppTile name={app.name} />
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{app.name}</span>
            <StatusPill tone={STATUS[app.status].tone}>{STATUS[app.status].text}</StatusPill>
            <DisconnectApp app={app} bots={(sibling(list.apps, app) ? [] : list.usage[app.toolkit] ?? []).map(name => bots.find(b => b.name === name)?.title ?? name)} onDone={() => void reload()} />
          </li>
        ))}
      </ul>
      {connecting
        ? <ConnectApp onConnected={() => { setConnecting(false); void reload() }} />
        : <Button type="button" size="sm" className="self-start" onClick={() => setConnecting(true)}>Connect an app</Button>}
    </div>
  )
}
