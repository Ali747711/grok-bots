export const APP_SERVER = 'crew_apps'
export const ARGS_TRUNCATED = '\n... [arguments truncated]'

export interface AppPrompt {
  readonly tool: string | null
  readonly argsTruncated: boolean
}

const HEAD = /^MCP tool '([^']+)' on UNTRUSTED server 'crew_apps' wants to run\./
const DESCRIPTION_HEAD = `Server '${APP_SERVER}' is configured 'trust: untrusted'.`
const MENTION = `server '${APP_SERVER}'`
const SURFACE = `mcp-trust/${APP_SERVER}`

/**
 * Recognises Hermes's trust prompt for a write-capable Crew app tool (live-proof ruling 1, R16).
 * Recognition only ever removes choices; a miss leaves the prompt as Hermes sent it.
 */
export function appPromptOf(params: Readonly<Record<string, unknown>>): AppPrompt | null {
  const command = typeof params.command === 'string' ? params.command : ''
  const description = typeof params.description === 'string' ? params.description.trimStart() : ''
  const head = HEAD.exec(command.trimStart())
  // Fail closed if Hermes rewords its prompt: any mention of the server counts.
  const mentions = command.includes(MENTION) || description.includes(MENTION)
  if (!head && !mentions && params.surface !== SURFACE && !description.startsWith(DESCRIPTION_HEAD)) return null
  return { tool: head?.[1] ?? null, argsTruncated: command.trimEnd().endsWith(ARGS_TRUNCATED.trim()) }
}

/** Only `once` and `deny`, in Hermes's order: "session" and "always" would allow later app actions silently. */
export function appChoices(choices: readonly string[] | undefined): readonly string[] {
  const kept = (choices ?? []).filter(c => c === 'once' || c === 'deny')
  return kept.length > 0 ? kept : ['once', 'deny']
}
