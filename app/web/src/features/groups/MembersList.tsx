import { Link } from 'react-router-dom'

import { CrewAvatar } from '@/features/avatars/CrewAvatar'
import type { BotStatus, BotView, GroupView } from '@/state/types'

import { memberTitle } from './group-titles'

const STATUS_TEXT: Record<BotStatus, string> = { idle: 'Idle', working: 'Working', needs_you: 'Needs you' }

/** Fixed members: avatar, title, @handle, status and a link to the bot's chat. A deleted bot is a plain row. */
export function MembersList({ group, bots }: { group: GroupView; bots: readonly BotView[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Members</h3>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {group.members.map(m => {
          const bot = bots.find(b => b.name === m.profile)
          const body = (
            <>
              {bot ? <CrewAvatar bot={bot} size={28} decorative /> : <span aria-hidden="true" className="size-7 rounded-xl bg-muted" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{bot ? memberTitle(group, bots, m.memberId) : 'Deleted bot'}</span>
                <span className="block truncate text-xs text-muted-foreground">{`@${m.handle}`}</span>
              </span>
              {bot && <span className="text-xs text-muted-foreground">{STATUS_TEXT[bot.status]}</span>}
            </>
          )
          return (
            <li key={m.memberId}>
              {bot ? (
                <Link to={`/bots/${encodeURIComponent(m.profile)}`} className="flex items-center gap-2.5 rounded-xl p-1.5 hover:bg-muted">{body}</Link>
              ) : (
                <div className="flex items-center gap-2.5 p-1.5">{body}</div>
              )}
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-muted-foreground">Members are set when the group is created. To change them, make a new group.</p>
    </div>
  )
}
