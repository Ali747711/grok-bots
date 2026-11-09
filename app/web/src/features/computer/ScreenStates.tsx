import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

/** The one-line install hint: Crew has no installer (§3 non-goals), so the user runs it on the host. */
export const INSTALL_COMMAND = 'hermes computer-use screen install'

export function ScreenLoading({ label = 'Loading the screen' }: { label?: string }) {
  return <Skeleton role="status" aria-label={label} className="aspect-video w-full rounded-lg" />
}

export function ScreenMissing({ command = INSTALL_COMMAND }: { command?: string | null }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border p-4 text-sm">
      <p className="font-medium">This bot's computer isn't set up yet</p>
      <p className="text-muted-foreground">On the host, run <code className="rounded bg-muted px-1 font-mono text-xs">{command ?? INSTALL_COMMAND}</code>, then open this tab again.</p>
    </div>
  )
}

interface OffProps {
  readonly onStart: () => void
  /** Hermes's reason the screen cannot start; Start stays disabled while it is set. */
  readonly blocker?: string
  readonly onCheck?: () => void
}

/** A stopped screen: the start button, or Hermes's reason verbatim with a way to check again. */
export function ScreenOff({ onStart, blocker, onCheck }: OffProps) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-border p-4 text-sm">
      <p className="text-muted-foreground">{blocker ?? "This bot's screen is off."}</p>
      <div className="flex gap-2">
        <Button size="sm" onClick={onStart} disabled={blocker !== undefined}>Start screen</Button>
        {blocker !== undefined && onCheck && <Button size="sm" variant="outline" onClick={onCheck}>Check again</Button>}
      </div>
    </div>
  )
}

/** `onRetry` is absent when retrying cannot help (an unsupported host). */
export function ScreenError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-border p-4 text-sm">
      <p className="text-destructive">{message}</p>
      {onRetry && <Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>}
    </div>
  )
}
