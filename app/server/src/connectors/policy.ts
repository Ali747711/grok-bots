import type { AppLevel } from './levels.js'

// The only values the Task 7 re-ruling may change. Type-only import: levels.ts imports this file at runtime.

/** Access levels a bot may be given (R9 still clamps bots that do not ask before actions). */
export const OFFERED_LEVELS: readonly AppLevel[] = ['read', 'change', 'all']

/** Most app tools one bot may hold, or null for no cap. */
export const PRELOAD_CAP: number | null = null

/** Background reconnect after an allowed-set change (R6): wait between disable and enable, and nudge chats. */
export const RECONNECT: { readonly gapMs: number; readonly nudge: boolean } = { gapMs: 2_000, nudge: true }

/** App actions that change something are declined in group chats (§11.7). */
export const ROOM_WRITES_DECLINED = false
