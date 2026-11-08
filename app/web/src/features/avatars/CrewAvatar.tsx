import { BotAvatar } from 'bot-avatars'

import { cn } from '@/lib/utils'
import type { BotView } from '@/state/types'

import { avatarSeed, avatarState, resolvedAvatar } from './avatar-model'
import { useNow } from './use-now'

interface CrewAvatarProps {
  bot: Pick<BotView, 'name' | 'avatar' | 'imageKind' | 'hasAvatar' | 'status' | 'hidden' | 'lastActive'>
  size: number
  /** Pickers pass false so the avatar does not react to the pointer. */
  interactive?: boolean
}

/** A bot's face: a plush-fur avatar (or its uploaded photo) with its status shown as motion, a ring or a dot. */
export function CrewAvatar({ bot, size, interactive = true }: CrewAvatarProps) {
  const now = useNow()
  const state = avatarState(bot, now)
  const look = resolvedAvatar(bot)
  const dim = state === 'sleeping' && 'opacity-60'
  return (
    <div className="relative flex-none" style={{ width: size, height: size }}>
      {look.kind === 'photo' ? (
        <div className={cn('size-full overflow-hidden rounded-[30%]', state === 'working' && 'ring-2 ring-sky', dim)}>
          <img src={`/crew/avatars/${encodeURIComponent(bot.name)}`} alt="" className="size-full object-cover" />
        </div>
      ) : (
        <div className={cn('size-full', dim)}>
          <BotAvatar
            shading="fabric"
            type={look.type}
            {...(look.color ? { color: look.color } : {})}
            state={state}
            seed={avatarSeed(bot.name)}
            size={size}
            interactive={interactive}
          />
        </div>
      )}
      {bot.status === 'needs_you' && (
        <span aria-label="Needs you" role="img" className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-card bg-needs" />
      )}
    </div>
  )
}
