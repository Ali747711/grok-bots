// Copy of the server's role list (server: bots/cosmetics.ts); the web never imports server code.

export const BOT_ROLES = ['researcher', 'engineer', 'operator', 'analyst', 'ops', 'generalist'] as const
export type BotRole = (typeof BOT_ROLES)[number]

export const ROLE_LABELS: Record<BotRole, string> = {
  researcher: 'Researcher',
  engineer: 'Engineer',
  operator: 'Operator',
  analyst: 'Analyst',
  ops: 'Ops',
  generalist: 'Generalist'
}
