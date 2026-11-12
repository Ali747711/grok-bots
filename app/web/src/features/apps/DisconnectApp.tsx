import { useState } from 'react'
import { toast } from 'sonner'

import { GHOST_ON_WELL } from '@/components/console/dialog-styles'
import { Button } from '@/components/ui/button'
import { ConfirmAction } from '@/features/triggers/ConfirmAction'

import { appsErrorText, disconnect } from './apps-api'
import type { ConnectedApp } from './apps-types'

interface Props { app: ConnectedApp; bots: readonly string[]; onDone: () => void }

export function DisconnectApp({ app, bots, onDone }: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const revoke = `revokes Crew's access to your ${app.name} account.`
  const description = bots.length > 0
    ? `${bots.join(', ')} use ${app.name}. Disconnecting removes it from them and ${revoke}`
    : `Disconnecting ${revoke}`
  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      await disconnect(app.id)
      toast.success(`${app.name} disconnected`)
      setOpen(false)
      onDone()
    } catch (e) {
      setOpen(false)
      setError(appsErrorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="ghost" size="sm" className={GHOST_ON_WELL} aria-label={`Disconnect ${app.name}`} onClick={() => setOpen(true)}>Disconnect</Button>
      {error && <p role="alert" className="px-2 text-xs font-medium text-destructive">{error}</p>}
      <ConfirmAction
        open={open} onOpenChange={setOpen} busy={busy} confirm="Disconnect" destructive
        title={`Disconnect ${app.name}?`} description={description} onConfirm={() => void run()}
      />
    </div>
  )
}
