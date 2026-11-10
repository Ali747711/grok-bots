import { ROLE_LABELS } from '@/features/bots/roles'
import type { BotView } from '@/state/types'

/** The model id without its provider path ("anthropic/claude-haiku-5.5" → "claude-haiku-5.5"); null when there is none. */
export function shortModel(model: string | null): string | null {
  const last = model?.split('/').at(-1)?.trim()
  return last ? last : null
}

/** The header's meta line: "Engineer · claude-haiku-5.5 · ≈ $0.12". Parts that are missing are left out. */
export function headerMeta(bot: BotView, cost: number | null): string {
  const parts = [
    bot.role ? ROLE_LABELS[bot.role] : null,
    shortModel(bot.model),
    cost === null ? null : `≈ $${cost.toFixed(2)}`
  ]
  return parts.filter((part): part is string => part !== null).join(' · ')
}
