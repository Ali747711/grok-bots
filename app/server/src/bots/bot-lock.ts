const tails = new Map<string, Promise<void>>()

/**
 * Run `run` after every earlier operation on the same bot has settled. Hermes writes `profile.yaml`
 * (description, ui_meta, revisions) with unlocked read-modify-write, so Crew must never overlap two
 * writes for one bot (F Gotcha 16). Different bots run concurrently; a rejection never blocks the next.
 */
export function withBotLock<T>(name: string, run: () => Promise<T>): Promise<T> {
  const result = (tails.get(name) ?? Promise.resolve()).then(run)
  const tail = result.then(() => undefined, () => undefined)
  tails.set(name, tail)
  void tail.then(() => {
    if (tails.get(name) === tail) tails.delete(name)
  })
  return result
}
