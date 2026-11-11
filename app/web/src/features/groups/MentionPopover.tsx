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
    <ul
      id={id}
      role="listbox"
      aria-label="Mention a bot"
      className="absolute bottom-full left-0 z-20 mb-2 flex max-h-60 w-72 max-w-full list-none scroll-thin flex-col gap-0.5 overflow-y-auto rounded-[22px] bg-popover p-1.5 text-popover-foreground shadow-lg ring-1 ring-foreground/5 dark:ring-foreground/10"
    >
      {options.map((o, i) => (
        <li
          key={o.handle}
          id={optionId(id, i)}
          role="option"
          aria-selected={i === active}
          // mousedown would blur the textarea before the click lands.
          onMouseDown={e => e.preventDefault()}
          onClick={() => onPick(o)}
          className={cn('flex h-10 cursor-pointer items-center gap-2.5 rounded-full pr-3 pl-1.5 transition-colors', i === active ? 'bg-raised' : 'hover:bg-hover')}
        >
          {o.bot ? <CrewAvatar bot={{ ...o.bot, status: 'idle' }} size={26} decorative /> : <span aria-hidden="true" className="size-[26px] flex-none rounded-[30%] bg-control" />}
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{o.title}</span>
          <span className="text-xs font-medium text-muted-foreground">{`@${o.handle}`}</span>
        </li>
      ))}
    </ul>
  )
}
