interface CaptionInput {
  /** Why sending is blocked (Hermes offline, reconnecting, connecting, working-bot limit), or null. */
  disabledReason: string | null
  /** A request for this chat is open in the cards above the composer. */
  waitingAbove: boolean
  /** A sent message is held behind the running turn. */
  queued: boolean
}

/** The one line under the composer, highest priority first; null when there is nothing to say. */
export function composerCaption({ disabledReason, waitingAbove, queued }: CaptionInput): string | null {
  if (disabledReason !== null) return disabledReason
  if (waitingAbove) return 'Waiting for you above'
  if (queued) return 'Queued. It goes in after the current turn.'
  return null
}
