import { CrewAvatar } from '@/features/avatars/CrewAvatar'
import type { BotView } from '@/state/types'

interface StackedAvatarsProps {
  /** A member whose bot no longer exists is null and shows as a neutral placeholder. */
  bots: readonly (BotView | null)[]
  size: number
  max?: number
}

// The cut-out around each avatar takes the colour of the surface behind the stack: set `--stack-ring`
// on a parent that is not the shell (a raised row, a well).
const RING = 'rounded-[30%] ring-2 ring-[var(--stack-ring,var(--shell))] transition-shadow'

/** Overlapping member avatars: up to `max`, then "+n". */
export function StackedAvatars({ bots, size, max = 3 }: StackedAvatarsProps) {
  const shown = bots.slice(0, max)
  const extra = bots.length - shown.length
  return (
    <span className="flex shrink-0 items-center -space-x-2.5">
      {shown.map((bot, i) => (
        <span key={bot?.name ?? `gone-${i}`} className={RING}>
          {bot ? (
            <CrewAvatar bot={bot} size={size} decorative />
          ) : (
            <span role="img" aria-label="Deleted bot" style={{ width: size, height: size }} className="block rounded-[30%] bg-control" />
          )}
        </span>
      ))}
      {extra > 0 && (
        <span style={{ height: size }} className="z-10 grid min-w-6 place-items-center rounded-full bg-raised px-1.5 text-[10px] font-semibold text-muted-foreground ring-2 ring-[var(--stack-ring,var(--shell))]">
          {`+${extra}`}
        </span>
      )}
    </span>
  )
}
