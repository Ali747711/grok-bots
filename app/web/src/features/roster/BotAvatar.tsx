import { useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils'
import type { BotView } from '@/state/types'

const PALETTE = ['#0891b2', '#ea580c', '#16a34a', '#db2777', '#2563eb', '#ca8a04', '#0d9488', '#dc2626']
const DEFAULT_COLOR = '#8b5cf6'

/** Stable colour per bot name when Hermes has none. */
export function avatarColor(bot: Pick<BotView, 'name' | 'color' | 'isPrimary'>): string {
  if (bot.color) return bot.color
  if (bot.isPrimary) return DEFAULT_COLOR
  let hash = 0
  for (const ch of bot.name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[hash % PALETTE.length] ?? DEFAULT_COLOR
}

/** 34 px bot avatar: the Hermes image when there is one, otherwise a coloured shape with the initial. */
export function BotAvatar({ bot, children }: { bot: BotView; children?: ReactNode }) {
  const [broken, setBroken] = useState(false)
  const shape = bot.shape === 'circle' ? 'rounded-full' : 'rounded-[10px]'
  const showImage = bot.hasAvatar && !broken
  return (
    <div
      data-testid={`avatar-${bot.name}`}
      className={cn('relative grid size-[34px] flex-none place-items-center font-bold text-white', shape)}
      style={{ backgroundColor: avatarColor(bot) }}
    >
      {showImage ? (
        <img
          src={`/crew/avatars/${encodeURIComponent(bot.name)}`}
          alt={bot.title}
          onError={() => setBroken(true)}
          className={cn('size-full object-cover', shape)}
        />
      ) : (
        bot.title.charAt(0).toUpperCase()
      )}
      {children}
    </div>
  )
}
