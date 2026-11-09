export interface SoulInput {
  readonly name: string
  readonly title: string
  readonly mission: string
  /** The official form's separate role line; Crew has one Name field, so it normally sends none. */
  readonly role?: string
}

/** Ported from hermes-bots/labels.ts `displayName` fallback: Title-cased name (Hermes 2bd378ed). */
function displayName(name: string, title: string): string {
  const t = title.trim()
  if (t) return t
  return name.replace(/[-_]+/g, ' ').trim().replace(/\b\w/g, ch => ch.toUpperCase())
}

/**
 * Ported from hermes-bots/soul.ts `composeSoul` for `serverInjectsProtocol = true` (Hermes 2bd378ed):
 * identity block only; Role/Mission lines are omitted when empty (Crew sends no role, so the name is
 * not repeated in the persona).
 */
export function composeSoul({ name, title, mission, role }: SoulInput): string {
  const display = displayName(name, title)
  return [
    `# ${display}`,
    '',
    role ? `**Role:** ${role}` : null,
    mission ? `**Mission:** ${mission}` : null,
    '',
    `You are ${display}, a persistent named agent (profile \`${name}\`) on this machine.`,
    'You keep your own memory, skills, and conversation history across sessions.'
  ]
    .filter(line => line !== null)
    .join('\n')
}
