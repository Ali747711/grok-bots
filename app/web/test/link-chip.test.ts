import { describe, expect, it } from 'vitest'

import type { LinkState } from '@/features/computer/live-session'
import type { ScreenControl, ScreenKind } from '@/features/computer/screen-state'
import { linkChip } from '@/features/side-panel/link-chip'

type Row = [kind: ScreenKind, link: LinkState, control: ScreenControl, text: string, accent: boolean]

// R11's table. The accent (the watermelon dot) is only for "Live" and "You're in control".
const TABLE: Row[] = [
  ['loading', 'idle', 'bot', 'Connecting…', false],
  ['starting', 'idle', 'bot', 'Connecting…', false],
  ['off', 'idle', 'bot', 'Off', false],
  ['missing', 'idle', 'bot', 'Off', false],
  ['low_memory', 'idle', 'bot', 'Off', false],
  ['error', 'idle', 'bot', 'Off', false],
  // A stopped screen is Off whatever the last link state was.
  ['off', 'live', 'you', 'Off', false],
  ['live', 'idle', 'bot', 'Connecting…', false],
  ['live', 'connecting', 'bot', 'Connecting…', false],
  ['live', 'connecting', 'you', 'Connecting…', false],
  ['live', 'reconnecting', 'you', 'Reconnecting…', false],
  ['live', 'reconnecting', 'bot', 'Reconnecting…', false],
  ['live', 'failed', 'bot', 'Not connected', false],
  ['live', 'failed', 'you', 'Not connected', false],
  ['live', 'live', 'you', "You're in control", true],
  ['live', 'live', 'someone', 'Someone is in control', false],
  ['live', 'live', 'bot', 'Live', true]
]

describe('linkChip (R11)', () => {
  it.each(TABLE)('%s screen, %s link, %s in control reads "%s"', (kind, link, control, text, accent) => {
    expect(linkChip(kind, link, control)).toEqual({ text, accent })
  })

  it('names the holder when one is known (PF25), and only for someone else', () => {
    expect(linkChip('live', 'live', 'someone', 'Ali')).toEqual({ text: 'Ali is in control', accent: false })
    expect(linkChip('live', 'live', 'someone', '  ')).toEqual({ text: 'Someone is in control', accent: false })
    expect(linkChip('live', 'live', 'you', 'Ali').text).toBe("You're in control")
    expect(linkChip('live', 'live', 'bot', 'Ali').text).toBe('Live')
  })
})
