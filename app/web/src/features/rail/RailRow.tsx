import { useState } from 'react'

import { Eye, EyeOff, Pin } from 'lucide-react'
import { motion } from 'motion/react'
import { toast } from 'sonner'

import { IconButton } from '@/components/console/icon-button'
import { STATUS_LABEL } from '@/components/console/status'
import { CrewAvatar } from '@/features/avatars/CrewAvatar'
import { updateBot } from '@/features/bots/bots-api'
import { SandboxBadge } from '@/features/bots/SandboxBadge'
import type { BotPatch } from '@/features/bots/types'
import { focusNeighborControl } from '@/lib/focus'
import { slide } from '@/lib/motion'
import { cn } from '@/lib/utils'
import type { BotView } from '@/state/types'

interface RailRowProps {
  bot: BotView
  active: boolean
  /** False while the rail is stale: the row dims and shows no live status. */
  showStatus: boolean
  onSelect: (name: string) => void
  /** The row is about to move to another section; the selector finds the control to focus again there. */
  onMoved: (selector: string | null) => void
}

const TAG = 'inline-flex h-4 shrink-0 items-center rounded-full bg-control px-1.5 text-[10px] font-medium text-muted-foreground'
const ACTION = 'size-7'

// Handles are slugs (letters, digits, dashes), so they need no escaping in a selector.
const rowSelector = (name: string) => `[data-bot="${name}"]`

/** The pin and hide writes for one bot. A failed write is said in a toast; the row itself changes when Crew's state arrives. */
function useRowActions({ bot, onMoved }: Pick<RailRowProps, 'bot' | 'onMoved'>) {
  const [busy, setBusy] = useState(false)

  /** Returns whether the write was saved. */
  const save = async (patch: BotPatch, failure: string): Promise<boolean> => {
    setBusy(true)
    try {
      const outcome = await updateBot(bot.name, patch)
      if (outcome.status !== 'saved') throw new Error(`Crew answered ${outcome.status}`)
      return true
    } catch {
      toast.error(`Couldn't ${failure} ${bot.title}. Try again.`)
      // The row is not going to move, so there is no focus to restore.
      onMoved(null)
      return false
    } finally {
      setBusy(false)
    }
  }

  const togglePin = () => {
    onMoved(`${rowSelector(bot.name)} [data-rail-action="pin"]`)
    // Unpin always sends `pinned: false`: a missing key would leave another app's copy pinned.
    void save({ pinned: !bot.pinned }, bot.pinned ? 'unpin' : 'pin')
  }

  const toggleHidden = async (control: HTMLElement) => {
    if (bot.hidden) onMoved(`${rowSelector(bot.name)} [data-rail-action="hide"]`)
    if (!(await save({ hidden: !bot.hidden }, bot.hidden ? 'show' : 'hide'))) return
    toast.success(bot.hidden ? 'Bot shown' : 'Bot hidden')
    // A hidden row leaves the list, so keyboard focus goes to the row beside it.
    if (!bot.hidden && control.isConnected) focusNeighborControl(control, '[data-bot]')
  }

  return { busy, togglePin, toggleHidden }
}

/** Pin and hide, shown on hover or focus. A hidden bot only offers Show. */
function RowActions({ bot, onMoved }: Pick<RailRowProps, 'bot' | 'onMoved'>) {
  const { busy, togglePin, toggleHidden } = useRowActions({ bot, onMoved })
  return (
    <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
      {!bot.hidden && (
        <IconButton label={`Pin ${bot.title}`} pressed={bot.pinned} disabled={busy} data-rail-action="pin" onClick={togglePin} className={ACTION}>
          <Pin className="size-3.5" fill={bot.pinned ? 'currentColor' : 'none'} />
        </IconButton>
      )}
      <IconButton
        label={`${bot.hidden ? 'Show' : 'Hide'} ${bot.title}`}
        disabled={busy}
        data-rail-action="hide"
        onClick={event => void toggleHidden(event.currentTarget)}
        className={ACTION}
      >
        {bot.hidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
      </IconButton>
    </div>
  )
}

/**
 * One bot in the rail: a 48 px pill with the avatar and its status dot, the title, the last message
 * and, on hover or focus, pin and hide. The primary bot carries a "Primary" tag and no actions.
 */
export function RailRow({ bot, active, showStatus, onSelect, onMoved }: RailRowProps) {
  return (
    <div
      data-bot={bot.name}
      className={cn(
        'group relative rounded-full transition-[background-color,opacity]',
        active ? '[--dot-ring:var(--raised)]' : '[--dot-ring:var(--shell)] hover:bg-hover hover:[--dot-ring:var(--hover)]',
        !showStatus && 'opacity-50'
      )}
    >
      {active && <motion.div layoutId="rail-active" transition={slide} className="absolute inset-0 rounded-full bg-raised" />}
      <button
        type="button"
        data-rail-row=""
        aria-current={active ? 'page' : undefined}
        onClick={() => onSelect(bot.name)}
        className={cn(
          'relative flex h-12 w-full items-center gap-2.5 rounded-full py-1.5 pr-3 pl-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring',
          !bot.isPrimary && (bot.hidden ? 'group-focus-within:pr-10 group-hover:pr-10' : 'group-focus-within:pr-[68px] group-hover:pr-[68px]')
        )}
      >
        {/* A stale rail must not show live status, so the avatar sees an idle copy (hidden and old bots still sleep). */}
        <CrewAvatar bot={showStatus ? bot : { ...bot, status: 'idle' }} size={32} decorative showStatus={showStatus} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[13px] leading-[18px] font-semibold">{bot.title}</span>
            {bot.sandbox === 'on' && <SandboxBadge />}
            {bot.isPrimary && <span className={TAG}>Primary</span>}
            {bot.setupIncomplete && <span className={TAG}>Finish setup</span>}
          </span>
          {showStatus && <span className="sr-only">{STATUS_LABEL[bot.status]}.</span>}
          <span className="block truncate text-xs leading-4 font-medium text-muted-foreground">{bot.preview ?? ' '}</span>
        </span>
      </button>
      {!bot.isPrimary && <RowActions bot={bot} onMoved={onMoved} />}
    </div>
  )
}
