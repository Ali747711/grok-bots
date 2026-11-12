import { Monitor } from 'lucide-react'

import { InlineAction } from '@/components/console/inline-action'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

/** The one-line install hint: Crew has no installer (§3 non-goals), so the user runs it on the host. */
export const INSTALL_COMMAND = 'hermes computer-use screen install'

// These states sit on the panel itself, not in a well: an error's red text is only readable on the shell.
const STATE = 'flex flex-col items-center gap-4 rounded-2xl px-4 py-8 text-center'
const TITLE = 'text-[15px] font-semibold tracking-tight'
const NOTE = 'text-[13px] font-medium text-muted-foreground'

export function ScreenLoading({ label = 'Loading the screen' }: { label?: string }) {
  return <Skeleton role="status" aria-label={label} className="aspect-video w-full shrink-0 rounded-2xl" />
}

export function ScreenMissing({ command = INSTALL_COMMAND }: { command?: string | null }) {
  return (
    <div className={STATE}>
      <p className={TITLE}>This bot's computer isn't set up yet</p>
      <p className={NOTE}>On the host, run <code className="rounded-md bg-raised px-1.5 py-0.5 font-mono text-xs text-foreground">{command ?? INSTALL_COMMAND}</code>, then open this tab again.</p>
    </div>
  )
}

interface OffProps {
  readonly title: string
  /** Starts the screen. It settles either way: a refusal shows as the error state, with Hermes's text. */
  readonly onStart: () => Promise<void>
  /** Hermes's reason the screen cannot start; Start stays disabled while it is set. */
  readonly blocker?: string
  readonly onCheck?: () => void
}

/** A stopped screen: the start action, or Hermes's reason verbatim with a way to check again. */
export function ScreenOff({ title, onStart, blocker, onCheck }: OffProps) {
  return (
    <div className={STATE}>
      <div className="flex flex-col gap-1">
        <p className={TITLE}>{title}'s screen is off.</p>
        {blocker !== undefined && <p className={NOTE}>{blocker}</p>}
      </div>
      <InlineAction label="Screen" icon={<Monitor className="size-5" aria-hidden="true" />} actionText="Start screen" onAction={onStart} disabled={blocker !== undefined} className="max-w-sm" />
      {blocker !== undefined && onCheck && <Button size="sm" variant="outline" onClick={onCheck}>Check again</Button>}
    </div>
  )
}

/** `onRetry` is absent when retrying cannot help (an unsupported host). */
export function ScreenError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className={STATE}>
      <p className="text-[13px] font-medium text-destructive">{message}</p>
      {onRetry && <Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>}
    </div>
  )
}
