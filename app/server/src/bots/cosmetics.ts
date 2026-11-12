import { z } from 'zod'

/** The roles a bot can wear in the roster; purely cosmetic, stored in `ui_meta`. */
export const BOT_ROLES = ['researcher', 'engineer', 'operator', 'analyst', 'ops', 'generalist'] as const
export type BotRole = (typeof BOT_ROLES)[number]
export const botRoleSchema = z.enum(BOT_ROLES)

/** A stored role when listed, else null. Never throws. */
export function readRole(value: unknown): BotRole | null {
  return typeof value === 'string' && (BOT_ROLES as readonly string[]).includes(value) ? (value as BotRole) : null
}

/** Only boolean `true` pins: a stale `'true'` or `1` from another client does not. */
export const readPinned = (value: unknown): boolean => value === true
