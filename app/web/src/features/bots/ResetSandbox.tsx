import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { ConfirmAction } from '../triggers/ConfirmAction'
import { resetSandbox, sandboxErrorText } from './sandbox-api'

interface Props { bot: string; title: string; onDone: () => void }

export function ResetSandbox({ bot, title, onDone }: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      await resetSandbox(bot)
      toast.success('Sandbox reset')
      setOpen(false)
      onDone()
    } catch (e) {
      setOpen(false)
      setError(sandboxErrorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setOpen(true)}>Reset sandbox</Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <ConfirmAction
        open={open} onOpenChange={setOpen} busy={busy} confirm="Reset sandbox" title="Reset the sandbox?"
        description={`This removes ${title}'s container, so the next command starts fresh. Installed packages and running processes are lost. Files in the bot's working folder are kept; anything else resets.`}
        onConfirm={() => void run()}
      />
    </div>
  )
}
