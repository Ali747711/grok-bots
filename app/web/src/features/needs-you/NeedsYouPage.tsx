import { Link } from 'react-router-dom'

import { CrewAvatar } from '@/features/avatars/CrewAvatar'
import { submitAnswer } from '@/features/requests/answer-request'
import { RequestCard } from '@/features/requests/RequestCard'
import { RevealHidden } from '@/features/requests/reveal-hidden'
import type { CrewState, PendingKind, PendingView } from '@/state/types'

const KIND_LABEL: Record<PendingKind, string> = { approval: 'Approval', clarify: 'Question', sudo: 'Password', secret: 'Secret' }

/** "just now", "2m ago", "3h ago", "2d ago". */
export function formatAge(receivedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - receivedAt) / 1000))
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86_400)}d ago`
}

interface EntryHeaderProps {
  entry: PendingView
  state: CrewState
  stale: boolean
  age: string
}

/** The card's header row: one link to the chat (or the group's room) holding who, kind, age and the summary. */
function EntryHeader({ entry, state, stale, age }: EntryHeaderProps) {
  const bot = state.bots.find(b => b.name === entry.profile)
  const room = entry.group ? state.groups?.rooms.find(r => r.id === entry.group!.roomId) : undefined
  const to = entry.group ? `/groups/${encodeURIComponent(entry.group.roomId)}` : `/bots/${encodeURIComponent(entry.profile)}`
  const who = bot?.title ?? entry.profile
  return (
    <Link to={to} className="-m-1.5 mb-1.5 flex items-start gap-3 rounded-xl p-1.5 outline-none hover:bg-hover focus-visible:ring-3 focus-visible:ring-ring">
      {bot && <CrewAvatar bot={stale ? { ...bot, status: 'idle' } : bot} size={32} decorative showStatus={!stale} />}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2 text-xs font-medium text-muted-foreground">
          <span className="min-w-0 truncate text-[13px] font-semibold text-foreground">{room ? `${who} in ${room.name}` : who}</span>
          <span className="shrink-0">{KIND_LABEL[entry.kind]}</span>
          <span className="ml-auto shrink-0">{age}</span>
        </span>
        <span className="mt-0.5 block text-sm break-words"><RevealHidden text={entry.summary} /></span>
        <span className="mt-1 block text-xs font-medium text-muted-foreground">Open chat</span>
      </span>
    </Link>
  )
}

/** Every open request across all bots and groups, oldest first: each is a request card whose header opens its chat. */
export function NeedsYouPage({ state, crewConnected = true, now = Date.now }: { state: CrewState; crewConnected?: boolean; now?: () => number }) {
  // A stale roster must not show live status, as in the sidebar.
  const stale = state.hermes !== 'connected' || !crewConnected
  const entries = [...state.pending].sort((a, b) => a.receivedAt - b.receivedAt)
  const count = entries.length
  return (
    <div className="min-h-0 flex-1 scroll-thin overflow-y-auto px-4 py-5">
      <div className="mx-auto max-w-[720px]">
        <div className="mb-4 flex items-center gap-2">
          <h2 className="text-[15px] font-semibold tracking-tight">Needs you</h2>
          {count > 0 && (
            <span aria-label={`${count} open ${count === 1 ? 'request' : 'requests'}`} className="rounded-full bg-raised px-2 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">
              {count}
            </span>
          )}
        </div>
        {count === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing needs you right now.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {entries.map(entry => (
              <li key={entry.id}>
                <RequestCard
                  entry={entry}
                  header={<EntryHeader entry={entry} state={state} stale={stale} age={formatAge(entry.receivedAt, now())} />}
                  onAnswer={(e, body) => submitAnswer(e.id, body)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
