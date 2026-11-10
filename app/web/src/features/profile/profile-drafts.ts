import { useCallback, useRef, useState } from 'react'

import { type FormSync, freshSync, isDirty, mergeFresh } from '@/features/bots/profile-form'
import type { BotDetail } from '@/features/bots/types'

// Unsaved profile edits, per bot, for the life of the tab (R8). Like the composer drafts, they live in
// this module so they outlive the profile page (Esc, Back, the rail, ⌥digit), and they are never
// written to storage. Each entry keeps the values the edits started from, so a change made elsewhere
// in the meantime is still a conflict on Save.
const drafts = new Map<string, FormSync>()

type Update = FormSync | ((previous: FormSync) => FormSync)

function remember(name: string, sync: FormSync): void {
  if (isDirty(sync)) drafts.set(name, sync)
  else drafts.delete(name)
}

/**
 * The profile form of one bot, next to its start values. It starts from the edits kept for this bot,
 * taken into the freshly read `detail` through `mergeFresh`, or from `detail` alone. Every change is
 * kept under the bot's name; a form with no edits left keeps nothing.
 */
export function useProfileDraft(name: string, detail: BotDetail): readonly [FormSync, (next: Update) => void] {
  const [sync, setState] = useState<FormSync>(() => {
    const kept = drafts.get(name)
    const start = kept ? mergeFresh(kept, detail) : freshSync(detail)
    // Edits Hermes already holds are no longer edits: drop the kept copy (idempotent, so safe to repeat).
    remember(name, start)
    return start
  })
  // The latest form, so two updates in one tick build on each other and the kept copy is never stale.
  const latest = useRef(sync)
  const setSync = useCallback((next: Update) => {
    const value = typeof next === 'function' ? next(latest.current) : next
    latest.current = value
    remember(name, value)
    setState(value)
  }, [name])
  return [sync, setSync] as const
}

/** Forget one bot's edits (it was deleted). */
export function dropProfileDraft(name: string): void {
  drafts.delete(name)
}

/** Drop every kept edit (tests start each case with none). */
export function clearProfileDrafts(): void {
  drafts.clear()
}
