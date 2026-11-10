import { useCallback, useSyncExternalStore } from 'react'

// Unsent composer text, per bot and per group, for the life of the tab (spec §6.3). It lives in this
// module so it outlives the conversation (profile, Needs you, a bot switch). It is never written to storage.
const drafts = new Map<string, string>()
const listeners = new Set<() => void>()

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

function notify(): void {
  for (const listener of [...listeners]) listener()
}

export const draftKey = {
  bot: (name: string): string => `bot:${name}`,
  group: (id: string): string => `group:${id}`
}

/** The draft under `key` and its setter; an empty text removes the entry. */
export function useDraft(key: string): readonly [string, (text: string) => void] {
  const text = useSyncExternalStore(subscribe, () => drafts.get(key) ?? '', () => '')
  const setText = useCallback((next: string) => {
    if (next === '') drafts.delete(key)
    else drafts.set(key, next)
    notify()
  }, [key])
  return [text, setText] as const
}

/** Drop every draft (tests start each case with none). */
export function clearDrafts(): void {
  drafts.clear()
  notify()
}
