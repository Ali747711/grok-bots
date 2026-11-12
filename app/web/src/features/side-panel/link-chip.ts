import type { LinkState } from '@/features/computer/live-session'
import type { ScreenControl, ScreenKind } from '@/features/computer/screen-state'

export interface LinkChipText {
  readonly text: string
  /** The watermelon dot: the screen is live, or the user holds control. */
  readonly accent: boolean
}

const plain = (text: string): LinkChipText => ({ text, accent: false })
const accented = (text: string): LinkChipText => ({ text, accent: true })

/**
 * What the side panel's header chip says about the screen (ruling R11). A stopped screen is "Off"
 * whatever the viewer last saw; who holds control is only said once the view is connected.
 * `holder` is the name of the other person in control when Hermes gives one (PF25).
 */
export function linkChip(kind: ScreenKind, link: LinkState, control: ScreenControl, holder?: string | null): LinkChipText {
  if (kind === 'loading' || kind === 'starting') return plain('Connecting…')
  if (kind !== 'live') return plain('Off')
  if (link === 'reconnecting') return plain('Reconnecting…')
  if (link === 'failed') return plain('Not connected')
  if (link !== 'live') return plain('Connecting…')
  if (control === 'you') return accented("You're in control")
  if (control === 'someone') return plain(`${holder?.trim() || 'Someone'} is in control`)
  return accented('Live')
}
