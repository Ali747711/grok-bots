import { useState } from 'react'

import { Button } from '@/components/ui/button'
import type { BotView } from '@/state/types'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

import type { ConnectedApp } from './apps-types'
import { AppTile } from './AppTile'
import { ConnectApp } from './ConnectApp'
import { DisconnectApp } from './DisconnectApp'
import { openDialog } from './open-dialog'
import { useApps } from './use-apps'

const STATUS_TEXT: Record<ConnectedApp['status'], string> = {
  connected: 'Connected', pending: 'Waiting for sign-in…', failed: 'Not connected'
}

function KeyProblem({ error, onSettings }: { error: string; onSettings: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2 text-sm">
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Apps</DialogTitle>
          <DialogDescription>Apps your bots can use, through Composio.</DialogDescription>
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
  if (error) return <p role="alert" className="text-sm">{error}</p>
  if (!list) return <p className="text-sm text-muted-foreground">Loading apps…</p>
  return (
    <div className="flex flex-col gap-3">
      {list.apps.length === 0 && <p className="text-sm text-muted-foreground">No apps connected yet.</p>}
      <ul className="flex flex-col gap-2">
        {list.apps.map(app => (
          <li key={app.id} className="flex items-center gap-2">
            <AppTile name={app.name} />
            <span className="min-w-0 flex-1 truncate text-sm">{app.name}</span>
            <span className="text-xs text-muted-foreground">{STATUS_TEXT[app.status]}</span>
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
