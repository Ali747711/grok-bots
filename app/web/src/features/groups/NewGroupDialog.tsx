import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { CrewAvatar } from '@/features/avatars/CrewAvatar'
import type { BotView } from '@/state/types'

import { createGroup, GroupApiError } from './groups-api'

const MIN_MEMBERS = 2
const MAX_MEMBERS = 6
const ROUTING_WARNING = "Group made, but Auto replies couldn't be switched on. Set it in the group panel."

interface NewGroupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Bots that can join: not hidden and seatable. The server still checks. */
  bots: readonly BotView[]
  onCreated: (roomId: string, warning?: string) => void
}

/** "<Title> can't join a group" when the server names the bot; else its plain-words message. */
function failureText(error: unknown, bots: readonly BotView[]): string {
  if (error instanceof GroupApiError) {
    const named = error.reason === 'not_in_roster' || error.reason === 'not_seatable'
    if (named && error.profile) return `${bots.find(b => b.name === error.profile)?.title ?? error.profile} can't join a group`
    return error.message
  }
  return 'Something went wrong. Try again.'
}

function NewGroupForm({ onOpenChange, bots, onCreated }: Omit<NewGroupDialogProps, 'open'>) {
  const [picked, setPicked] = useState<string[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titles = picked.map(n => bots.find(b => b.name === n)?.title ?? n)
  const full = picked.length >= MAX_MEMBERS

  const toggle = (botName: string, on: boolean) => {
    setError(null)
    setPicked(prev => (on ? [...prev, botName] : prev.filter(n => n !== botName)))
  }
  const submit = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const trimmed = name.trim()
      const result = await createGroup({ ...(trimmed ? { name: trimmed } : {}), members: picked })
      if (result.warning) toast.success(ROUTING_WARNING)
      onOpenChange(false)
      onCreated(result.roomId, result.warning)
    } catch (e) {
      setError(failureText(e, bots))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="group-name" className="text-sm font-medium">Group name</label>
        <Input id="group-name" value={name} maxLength={64} placeholder={titles.join(', ')} onChange={e => setName(e.target.value)} />
      </div>
      <ul className="m-0 flex max-h-64 list-none flex-col gap-0.5 overflow-y-auto p-0">
        {bots.map(bot => {
          const on = picked.includes(bot.name)
          const blocked = !on && full
          return (
            <li key={bot.name}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-xl p-1.5 hover:bg-muted">
                <Checkbox
                  checked={on}
                  disabled={blocked}
                  aria-label={bot.title}
                  title={blocked ? `Up to ${MAX_MEMBERS} bots` : undefined}
                  onCheckedChange={checked => toggle(bot.name, checked)}
                />
                <CrewAvatar bot={{ ...bot, status: 'idle' }} size={28} decorative />
                <span className="truncate text-sm font-medium">{bot.title}</span>
              </label>
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-muted-foreground">Members are set when the group is created.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button type="button" disabled={busy || picked.length < MIN_MEMBERS} onClick={() => void submit()}>Create group</Button>
      </div>
    </>
  )
}

/** Make a group: pick 2 to 6 bots and optionally name it. */
export function NewGroupDialog({ open, onOpenChange, bots, onCreated }: NewGroupDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New group</DialogTitle>
          <DialogDescription>Pick 2–6 bots</DialogDescription>
        </DialogHeader>
        <NewGroupForm onOpenChange={onOpenChange} bots={bots} onCreated={onCreated} />
      </DialogContent>
    </Dialog>
  )
}
