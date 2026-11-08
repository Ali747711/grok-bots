import { BotAvatar } from 'bot-avatars'
import { useState } from 'react'

import { cn } from '@/lib/utils'
import type { BotView } from '@/state/types'

import { avatarSeed, avatarState, resolvedAvatar } from './avatar-model'
import { useNow } from './use-now'

interface CrewAvatarProps {
  bot: Pick<BotView, 'name' | 'title' | 'avatar' | 'imageKind' | 'hasAvatar' | 'status' | 'hidden' | 'lastActive'>
  size: number
  /** Pickers pass false so the avatar does not react to the pointer. */
  interactive?: boolean
  /** The bot's name sits right beside the avatar (roster rows), so hide the avatar from assistive tech. */
  decorative?: boolean
}

/** A bot's face: a plush-fur avatar (or its uploaded photo) with its status shown as motion, a ring or a dot. */
export function CrewAvatar({ bot, size, interactive = true, decorative = false }: CrewAvatarProps) {
  const now = useNow()
  const state = avatarState(bot, now)
  // Photo load failures are remembered per bot and photo, so a new bot or a new upload retries.
  const photoKey = `${bot.name}:${bot.imageKind}`
  const [brokenKey, setBrokenKey] = useState<string | null>(null)
  const resolved = resolvedAvatar(bot)
  const look = resolved.kind === 'photo' && brokenKey === photoKey ? resolvedAvatar({ ...bot, imageKind: null }) : resolved
  const dim = state === 'sleeping' && 'opacity-60'
  return (
    <div className="relative flex-none" aria-hidden={decorative || undefined} style={{ width: size, height: size }}>
      {look.kind === 'photo' ? (
        <div className={cn('size-full overflow-hidden rounded-[30%]', state === 'working' && 'ring-2 ring-sky', dim)}>
          <img src={`/crew/avatars/${encodeURIComponent(bot.name)}`} alt={decorative ? '' : bot.title} onError={() => setBrokenKey(photoKey)} className="size-full object-cover" />
        </div>
      ) : (
        <div className={cn('size-full', dim)}>
          <BotAvatar
            shading="fabric"
            aria-label={decorative ? undefined : bot.title}
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
