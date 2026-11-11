import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { CrewAvatar } from '@/features/avatars/CrewAvatar'
import { cn } from '@/lib/utils'
import type { BotView } from '@/state/types'

import { groupHandle } from './group-titles'
import { createGroup, GroupApiError } from './groups-api'

const MIN_MEMBERS = 2
const MAX_MEMBERS = 6
/** A rail-style pill row; the picked ones lift to the raised surface. */
const ROW = 'flex h-12 items-center gap-2.5 rounded-full py-1.5 pr-3.5 pl-2 transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring'
/** The box sits on a row that turns raised, so it is drawn on the control surface with a round shape. */
const CHECK = 'size-[18px] rounded-full bg-control focus-visible:ring-0'
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

interface MemberPickProps {
  bot: BotView
  on: boolean
  /** The group is full and this bot is not in it. */
  blocked: boolean
  onToggle: (on: boolean) => void
}

/** One bot to pick: a rail-style row with its avatar, title, group handle and the checkbox. */
function MemberPick({ bot, on, blocked, onToggle }: MemberPickProps) {
  return (
    // `data-bot` as on the rail rows: the visual check masks every row that is not a test bot's.
    <li data-bot={bot.name}>
      <label className={cn(ROW, on ? 'bg-raised' : !blocked && 'hover:bg-hover', blocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}>
        <CrewAvatar bot={{ ...bot, status: 'idle' }} size={30} decorative />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-[18px] font-semibold">{bot.title}</span>
          <span className="block truncate text-xs leading-4 font-medium text-muted-foreground">{`@${groupHandle(bot.name)}`}</span>
        </span>
        <Checkbox checked={on} disabled={blocked} aria-label={bot.title} title={blocked ? `Up to ${MAX_MEMBERS} bots` : undefined} onCheckedChange={onToggle} className={CHECK} />
      </label>
    </li>
  )
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
      <div className="flex flex-col gap-2">
        <label htmlFor="group-name" className="px-1 text-[13px] font-semibold">Group name</label>
        <Input id="group-name" value={name} maxLength={64} autoComplete="off" placeholder={titles.join(', ')} onChange={e => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2 px-1">
          <span className="text-[13px] font-semibold">Bots</span>
          <span role="status" className="text-xs font-medium text-faint tabular-nums">{`${picked.length} of ${MAX_MEMBERS} picked`}</span>
        </div>
        <ul className="m-0 flex max-h-64 list-none scroll-thin flex-col gap-0.5 overflow-y-auto p-0">
          {bots.map(bot => {
            const on = picked.includes(bot.name)
            return <MemberPick key={bot.name} bot={bot} on={on} blocked={!on && full} onToggle={checked => toggle(bot.name, checked)} />
          })}
        </ul>
        <p className="px-1 text-xs font-medium text-faint">Members are set when the group is created.</p>
      </div>
      {error && <p role="alert" className="px-1 text-[13px] font-medium text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button type="button" disabled={busy || picked.length < MIN_MEMBERS} onClick={() => void submit()}>Create group</Button>
      </div>
    </>
  )
}

/** Make a group: pick 2 to 6 bots and optionally name it. */
export function NewGroupDialog({ open, onOpenChange, bots, onCreated }: NewGroupDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-5 overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-semibold tracking-tight">New group</DialogTitle>
          <DialogDescription className="text-[13px] font-medium">Pick 2–6 bots</DialogDescription>
        </DialogHeader>
        <NewGroupForm onOpenChange={onOpenChange} bots={bots} onCreated={onCreated} />
      </DialogContent>
    </Dialog>
  )
}
