import { Link } from 'react-router-dom'

import { Section } from '@/components/console/fields'
import { StatusChip } from '@/components/console/status'
import { CrewAvatar } from '@/features/avatars/CrewAvatar'
import type { BotView, GroupView } from '@/state/types'

import { memberTitle } from './group-titles'

const ROW = 'flex h-12 items-center gap-2.5 rounded-full py-1.5 pr-2.5 pl-2'

/** Fixed members as rail-style rows: avatar, title, @handle, status and a link to the bot's chat. A deleted bot is a plain row. */
export function MembersList({ group, bots, stale }: { group: GroupView; bots: readonly BotView[]; stale: boolean }) {
  return (
    <Section title="Members" hint="Members are set when the group is created. To change them, make a new group.">
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {group.members.map(m => {
          const bot = bots.find(b => b.name === m.profile)
          const body = (
            <>
              {bot ? <CrewAvatar bot={stale ? { ...bot, status: 'idle' } : bot} size={30} decorative /> : <span aria-hidden="true" className="size-[30px] flex-none rounded-[30%] bg-control" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] leading-[18px] font-semibold">{bot ? memberTitle(group, bots, m.memberId) : 'Deleted bot'}</span>
                <span className="block truncate text-xs leading-4 font-medium text-muted-foreground">{`@${m.handle}`}</span>
              </span>
              {bot && !stale && <StatusChip status={bot.status} />}
            </>
          )
          return (
            <li key={m.memberId}>
              {bot ? (
                <Link to={`/bots/${encodeURIComponent(m.profile)}`} className={`${ROW} outline-none transition-colors hover:bg-hover focus-visible:ring-3 focus-visible:ring-ring`}>{body}</Link>
              ) : (
                <div className={ROW}>{body}</div>
              )}
            </li>
          )
        })}
      </ul>
    </Section>
  )
}
