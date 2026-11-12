import { cn } from '@/lib/utils'

import { type RecentAction, formatClock } from './recent-actions'

interface RecentActionsProps {
  readonly title: string
  readonly actions: readonly RecentAction[]
}

function ActionRow({ action, newest }: { action: RecentAction; newest: boolean }) {
  return (
    <li className="flex h-8 items-center gap-3 px-3 text-[13px] font-medium">
      <time className="w-10 shrink-0 font-mono text-xs text-faint tabular-nums">{action.at === null ? '' : formatClock(action.at)}</time>
      <span className="max-w-[40%] shrink-0 truncate text-muted-foreground">{action.name}</span>
      <span className={cn('min-w-0 flex-1 truncate', newest ? 'text-foreground' : 'text-muted-foreground')}>{action.summary}</span>
      {action.failed && (
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-foreground">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-status-error" />
          Failed
        </span>
      )}
    </li>
  )
}

/** The bot's chat tool steps, newest first. Adapted from crew-bots' action log. */
export function RecentActions({ title, actions }: RecentActionsProps) {
  return (
    <section aria-label={`${title}'s recent actions`} className="flex min-h-[148px] flex-1 flex-col rounded-2xl bg-background p-1.5">
      <h3 className="shrink-0 px-3 pt-2 pb-1.5 text-xs font-semibold text-faint">Recent actions</h3>
      {actions.length === 0 ? (
        <p className="px-3 py-2 text-[13px] font-medium text-faint">No actions yet.</p>
      ) : (
        <ol className="m-0 min-h-0 flex-1 list-none scroll-thin overflow-y-auto p-0">
          {actions.map((action, index) => <ActionRow key={action.id} action={action} newest={index === 0} />)}
        </ol>
      )}
    </section>
  )
}
