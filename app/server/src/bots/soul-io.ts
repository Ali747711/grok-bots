import type { BotDeps } from './create.js'
import { composeSoul, hasHouseBlock, nowOf, ownerPartOf } from './soul.js'

const soulPath = (name: string): string => `/api/profiles/${encodeURIComponent(name)}/soul`

/** The whole SOUL.md, house block included; '' when the profile has no Soul file. */
export async function readSoulFile(deps: Pick<BotDeps, 'rest'>, name: string): Promise<string> {
  const soul = await deps.rest.request<{ content?: string | null; exists?: boolean }>('GET', soulPath(name))
  return soul.exists === false ? '' : (soul.content ?? '')
}

/** Replace the whole SOUL.md. The caller holds the bot lock. */
export async function writeSoulFile(deps: Pick<BotDeps, 'rest'>, name: string, content: string): Promise<void> {
  await deps.rest.request('PUT', soulPath(name), { body: { content } })
}

/**
 * Save what the owner wrote: any house block they pasted is Crew's and is dropped. A fresh block is added
 * when the file had one or the bot is in the voice scope; otherwise the owner's text is saved as written,
 * so a bot outside the scope is never half-converted by a Soul-tab save. A "Right now" block already in
 * the file (Soul carrier) is kept. The caller holds the lock.
 */
export async function saveOwnerPart(deps: Pick<BotDeps, 'rest' | 'voice'>, name: string, owner: string): Promise<void> {
  const current = await readSoulFile(deps, name)
  const text = ownerPartOf(owner)
  const withHouse = hasHouseBlock(current) || (deps.voice?.inScope(name) ?? true)
  await writeSoulFile(deps, name, withHouse ? composeSoul(text, nowOf(current) ?? undefined) : text)
}
