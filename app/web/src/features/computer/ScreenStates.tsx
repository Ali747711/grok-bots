import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

/** The one-line install hint: Crew has no installer (§3 non-goals), so the user runs it on the host. */
export const INSTALL_COMMAND = 'hermes computer-use screen install'

export function ScreenLoading({ label = 'Loading the screen' }: { label?: string }) {
  return <Skeleton role="status" aria-label={label} className="aspect-video w-full rounded-lg" />
}

export function ScreenMissing() {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border p-4 text-sm">
      <p className="font-medium">This bot's computer isn't set up yet</p>
      <p className="text-muted-foreground">On the host, run <code className="rounded bg-muted px-1 font-mono text-xs">{INSTALL_COMMAND}</code>, then open this tab again.</p>
    </div>
  )
}

interface ActionProps {
  readonly onStart: () => void
  readonly message?: string
}

/** A stopped screen: the start button, with Hermes's reason verbatim when it cannot start. */
export function ScreenOff({ onStart, message }: ActionProps) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-border p-4 text-sm">
      <p className="text-muted-foreground">{message ?? "This bot's screen is off."}</p>
      <Button size="sm" onClick={onStart}>Start screen</Button>
    </div>
  )
}

export function ScreenError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-border p-4 text-sm">
      <p className="text-contrast-danger">{message}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>
    </div>
  )
}
