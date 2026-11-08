import { Link } from 'react-router-dom'

import { BotAvatar } from '@/features/roster/BotAvatar'
import type { CrewState, PendingKind } from '@/state/types'

const KIND_LABEL: Record<PendingKind, string> = { approval: 'Approval', clarify: 'Question', sudo: 'Password', secret: 'Secret' }

/** "just now", "2m ago", "3h ago", "2d ago". */
export function formatAge(receivedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - receivedAt) / 1000))
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86_400)}d ago`
}

/** Every open request across all bots, oldest first; each row opens that bot's chat. */
export function NeedsYouPage({ state, now = Date.now }: { state: CrewState; now?: () => number }) {
  const entries = [...state.pending].sort((a, b) => a.receivedAt - b.receivedAt)
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-[720px]">
        <h2 className="mb-4 text-base font-semibold">Needs you</h2>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing needs you right now.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {entries.map(entry => {
              const bot = state.bots.find(b => b.name === entry.profile)
              return (
                <li key={entry.id}>
                  <Link to={`/bots/${encodeURIComponent(entry.profile)}`} className="flex items-start gap-3 rounded-xl border border-border bg-card p-3 hover:bg-secondary">
                    {bot && <BotAvatar bot={bot} />}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2 text-xs text-muted-foreground">
                        <span className="text-sm font-semibold text-foreground">{bot?.title ?? entry.profile}</span>
                        <span>{KIND_LABEL[entry.kind]}</span>
                        <span className="ml-auto">{formatAge(entry.receivedAt, now())}</span>
                      </span>
                      <span className="mt-0.5 block text-sm break-words">{entry.summary}</span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
