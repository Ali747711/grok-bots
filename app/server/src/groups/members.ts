import type { HermesRoomMember } from './types.js'

const MIN_MEMBERS = 2
const MAX_MEMBERS = 6
const MAX_NAME = 64

export type MemberValidation =
  | { ok: true }
  | { ok: false; reason: 'count' | 'duplicate' | 'not_in_roster' | 'not_seatable'; profile?: string }

/** The official roster rule: the default bot answers to @hermes, every other bot to its profile name. */
export function handleFor(profile: string): string {
  return profile === 'default' ? 'hermes' : profile
}

/** `display_name` is sent only when the profile has a non-empty one (Hermes drops nothing else). */
export function buildMemberRows(profiles: readonly string[], displayNames: ReadonlyMap<string, string>): HermesRoomMember[] {
  return profiles.map(profile => {
    const displayName = displayNames.get(profile)
    return {
      member_id: profile,
      profile,
      handle: handleFor(profile),
      ...(displayName ? { display_name: displayName } : {}),
      target: { kind: 'local' as const, profile }
    }
  })
}

export function validateMembers(profiles: readonly string[], roster: ReadonlySet<string>, seatable: ReadonlySet<string>): MemberValidation {
  if (profiles.length < MIN_MEMBERS || profiles.length > MAX_MEMBERS) return { ok: false, reason: 'count' }
  const seen = new Set<string>()
  for (const profile of profiles) {
    const key = profile.toLowerCase()
    if (seen.has(key)) return { ok: false, reason: 'duplicate', profile }
    seen.add(key)
  }
  for (const profile of profiles) if (!roster.has(profile)) return { ok: false, reason: 'not_in_roster', profile }
  for (const profile of profiles) if (!seatable.has(profile)) return { ok: false, reason: 'not_seatable', profile }
  return { ok: true }
}

export function defaultGroupName(titles: readonly string[]): string {
  return titles.join(', ').slice(0, MAX_NAME)
}
