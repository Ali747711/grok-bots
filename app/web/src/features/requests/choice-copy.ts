const COPY: Record<string, { label: string; hint: string }> = {
  once: { label: 'Allow once', hint: 'Just this time' },
  session: { label: 'Allow for this chat', hint: 'Saves a rule for this kind of command until the chat ends' },
  always: { label: 'Always allow', hint: 'Saves a permanent rule for this kind of command for this bot' },
  deny: { label: 'Deny', hint: 'The bot is told no' }
}

/** Plain-words label and scope hint for an approval choice Hermes offered; unknown choices show as sent. */
export function choiceCopy(choice: string): { label: string; hint: string } {
  return COPY[choice] ?? { label: choice, hint: '' }
}
