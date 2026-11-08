import { describe, expect, it } from 'vitest'

import { deriveScreen } from '@/features/computer/screen-state'
import type { DisplayStatus } from '@/vendor/hermes/gateway-contract.generated'

const status = (over: Partial<DisplayStatus> = {}): DisplayStatus => ({
  profile: 'scout', supported: true, installed: true, missing: [], running: false, geometry: '1440x900',
  lease: { holder: 'agent', since: 1, epoch: 1 }, profile_key: '/h/scout', ...over
})
const human = (hash: string, epoch = 2) => ({ holder: 'human' as const, viewer_hash: hash, since: 2, epoch })

describe('deriveScreen', () => {
  it('derives every screen state and who is in control', () => {
    expect(deriveScreen(null, {}).kind).toBe('starting')
    expect(deriveScreen(status({ installed: false }), {}).kind).toBe('missing')
    expect(deriveScreen(status(), {}).kind).toBe('off')
    expect(deriveScreen(status({ blocker: 'Not enough free memory' }), {})).toMatchObject({ kind: 'low_memory', message: 'Not enough free memory' })
    expect(deriveScreen(status(), { starting: true }).kind).toBe('starting')
    expect(deriveScreen(status({ supported: false }), {}).kind).toBe('error')
    expect(deriveScreen(status(), { error: 'boom' })).toMatchObject({ kind: 'error', message: 'boom' })
    expect(deriveScreen(null, { error: 'boom' }).kind).toBe('error')

    const live = status({ running: true })
    expect(deriveScreen(live, {})).toMatchObject({ kind: 'live', control: 'bot' })
    const held = status({ running: true, lease: human('aaa') })
    expect(deriveScreen(held, {}, 'aaa').control).toBe('you')
    expect(deriveScreen(held, {}, 'bbb').control).toBe('someone')
    expect(deriveScreen(held, {}).control).toBe('someone')
    expect(deriveScreen(held, {}, null).control).toBe('someone')
  })

  it('prefers a newer lease from an event and ignores an older one', () => {
    const live = status({ running: true, lease: { holder: 'agent', since: 1, epoch: 5 } })
    expect(deriveScreen(live, { lease: human('aaa', 6) }, 'aaa').control).toBe('you')
    expect(deriveScreen(live, { lease: human('aaa', 4) }, 'aaa').control).toBe('bot')
  })
})
