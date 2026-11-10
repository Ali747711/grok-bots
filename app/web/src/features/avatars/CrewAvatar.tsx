import { BotAvatar } from 'bot-avatars'
import { useState } from 'react'

import { StatusDot } from '@/components/console/status'
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
  /** Adds the corner status dot (rail rows). Set `--dot-ring` on a parent to the surface behind the avatar. */
  showStatus?: boolean
}

/** A bot's face: a plush-fur avatar (or its uploaded photo) with its status shown as motion, a ring and, when asked, a corner dot. */
export function CrewAvatar({ bot, size, interactive = true, decorative = false, showStatus = false }: CrewAvatarProps) {
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
        <div className={cn('size-full overflow-hidden rounded-[30%]', state === 'working' && 'ring-2 ring-status-working', dim)}>
          <img src={`/crew/avatars/${encodeURIComponent(bot.name)}`} alt={decorative ? '' : bot.title} onError={() => setBrokenKey(photoKey)} className="size-full object-cover" />
        </div>
      ) : (
        // Reduced motion freezes the working animation, so a ring (as on photos) keeps the state visible.
        <div className={cn('size-full', state === 'working' && 'rounded-[30%] motion-reduce:ring-2 motion-reduce:ring-status-working', dim)}>
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
      {showStatus && (
        // The dot sits in a cut-out the colour of the surface behind the avatar.
        <span className="absolute -right-0.5 -bottom-0.5 flex size-3 items-center justify-center rounded-full bg-[var(--dot-ring,var(--shell))] transition-colors">
          <StatusDot status={bot.status} />
        </span>
      )}
    </div>
  )
}
