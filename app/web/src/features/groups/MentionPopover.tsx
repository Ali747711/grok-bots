import { CrewAvatar } from '@/features/avatars/CrewAvatar'
import { cn } from '@/lib/utils'
import type { BotView } from '@/state/types'

export interface MentionOption {
  /** What is inserted after the "@". */
  readonly handle: string
  readonly title: string
  /** Null for @everyone and for members whose bot was deleted. */
  readonly bot: BotView | null
}

interface MentionPopoverProps {
  id: string
  options: readonly MentionOption[]
  active: number
  onPick: (option: MentionOption) => void
}

export const optionId = (id: string, index: number): string => `${id}-opt-${index}`

/** Listbox of members to mention, shown above the message box. The textarea keeps focus. */
export function MentionPopover({ id, options, active, onPick }: MentionPopoverProps) {
  return (
    <ul id={id} role="listbox" aria-label="Mention a bot" className="absolute bottom-full left-0 z-10 mb-2 max-h-56 w-72 list-none overflow-y-auto rounded-2xl border border-border bg-popover p-1 text-popover-foreground shadow-md">
      {options.map((o, i) => (
        <li
          key={o.handle}
          id={optionId(id, i)}
          role="option"
          aria-selected={i === active}
          // mousedown would blur the textarea before the click lands.
          onMouseDown={e => e.preventDefault()}
          onClick={() => onPick(o)}
          className={cn('flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-sm', i === active && 'bg-muted')}
        >
          {o.bot ? <CrewAvatar bot={{ ...o.bot, status: 'idle' }} size={24} decorative /> : <span aria-hidden="true" className="size-6 rounded-lg bg-muted" />}
          <span className="min-w-0 flex-1 truncate font-medium">{o.title}</span>
          <span className="text-xs text-muted-foreground">{`@${o.handle}`}</span>
        </li>
      ))}
    </ul>
  )
}
