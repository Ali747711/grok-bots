import { Link } from 'react-router-dom'

import { CrewAvatar } from '@/features/avatars/CrewAvatar'
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
export function NeedsYouPage({ state, crewConnected = true, now = Date.now }: { state: CrewState; crewConnected?: boolean; now?: () => number }) {
  // A stale roster must not show live status, as in the sidebar.
  const stale = state.hermes !== 'connected' || !crewConnected
  const entries = [...state.pending].sort((a, b) => a.receivedAt - b.receivedAt)
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-[720px]">
        <h2 className="mb-4 text-base font-semibold">Needs you</h2>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing needs you right now.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {entries.map(entry => {
              const bot = state.bots.find(b => b.name === entry.profile)
              const room = entry.group ? state.groups?.rooms.find(r => r.id === entry.group!.roomId) : undefined
              const to = entry.group ? `/groups/${encodeURIComponent(entry.group.roomId)}` : `/bots/${encodeURIComponent(entry.profile)}`
              const who = bot?.title ?? entry.profile
              return (
                <li key={entry.id}>
                  <Link to={to} className="flex items-start gap-3 rounded-2xl p-2.5 hover:bg-muted">
                    {bot && <CrewAvatar bot={stale ? { ...bot, status: 'idle' } : bot} size={32} decorative showStatus={!stale} />}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2 text-xs text-muted-foreground">
                        <span className="min-w-0 truncate text-sm font-semibold text-foreground">{room ? `${who} in ${room.name}` : who}</span>
                        <span className="shrink-0">{KIND_LABEL[entry.kind]}</span>
                        <span className="ml-auto shrink-0">{formatAge(entry.receivedAt, now())}</span>
                      </span>
                      <span className="mt-0.5 block text-sm break-words">{entry.summary}</span>
                      <span className="mt-1 block text-xs font-medium text-foreground">Open chat</span>
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
