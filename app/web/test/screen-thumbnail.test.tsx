import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeClient } from './fake-client'
import { bot } from './fixtures'

const client = new FakeClient()
vi.mock('@/chat/gateway', () => ({ connectGateway: () => client }))

const { ChatHeader } = await import('@/features/chat/ChatHeader')

const dev = bot({ name: 'dev', title: 'Dev' })
const JPEG = 'data:image/jpeg;base64,/9j/AAA'
let running: boolean
let thumb: () => unknown

const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const thumbCalls = () => client.callsOf('display.thumbnail')
const setVisibility = (value: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { value, configurable: true })
  act(() => { document.dispatchEvent(new Event('visibilitychange')) })
}
const header = (panel: 'computer' | null = null, onPanel: (t: string | null) => void = () => undefined) =>
  <ChatHeader bot={dev} stale={false} panel={panel} onPanel={onPanel} />

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  client.calls = []
  client.setState('open')
  running = true
  thumb = () => ({ data_url: JPEG })
  client.handlers = {
    'display.status': () => ({ profile: 'dev', supported: true, installed: true, missing: [], running, geometry: '1440x900', profile_key: '/h/dev', lease: { holder: 'agent', since: 1, epoch: 1 } }),
    'display.thumbnail': () => thumb()
  }
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})

describe('header thumbnail', () => {
  it('polls every four seconds only while live, visible and the tab is closed', async () => {
    const { rerender } = render(header())
    await flush()
    expect(thumbCalls()).toHaveLength(1)
    expect(thumbCalls()[0]!.params).toEqual({ profile: 'dev' })
    expect(thumbCalls()[0]!.timeoutMs).toBe(5000)
    await flush(3999)
    expect(thumbCalls()).toHaveLength(1)
    await flush(1)
    expect(thumbCalls()).toHaveLength(2)
    expect(screen.getByRole('img', { name: "Dev's screen" })).toHaveAttribute('src', JPEG)

    setVisibility('hidden')
    await flush(12_000)
    expect(thumbCalls()).toHaveLength(2)
    setVisibility('visible')
    await flush()
    expect(thumbCalls()).toHaveLength(3)

    rerender(header('computer'))
    await flush(12_000)
    expect(thumbCalls()).toHaveLength(3)
    expect(screen.queryByRole('img', { name: "Dev's screen" })).toBeNull()
  })

  it('does not poll and shows nothing while the screen is stopped', async () => {
    running = false
    render(header())
    await flush(9000)
    expect(thumbCalls()).toHaveLength(0)
    expect(screen.queryByRole('button', { name: "Open Dev's screen" })).toBeNull()
  })

  it('shows the control chip when suppressed and hides when the screen answers null', async () => {
    thumb = () => ({ data_url: null, suppressed: 'human_has_control' })
    render(header())
    await flush()
    expect(screen.getByText('Someone is in control')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: "Dev's screen" })).toBeNull()
    thumb = () => ({ data_url: null })
    await flush(4000)
    expect(screen.queryByText('Someone is in control')).toBeNull()
    expect(screen.queryByRole('button', { name: "Open Dev's screen" })).toBeNull()
  })

  it('marks the thumbnail stale after three misses and recovers on a good frame', async () => {
    render(header())
    await flush()
    thumb = () => { throw new Error('timeout') }
    await flush(4000)
    await flush(4000)
    expect(screen.getByRole('button', { name: "Open Dev's screen" })).not.toHaveAttribute('data-stale')
    await flush(4000)
    expect(screen.getByRole('button', { name: "Open Dev's screen" })).toHaveAttribute('data-stale', 'true')
    thumb = () => ({ data_url: JPEG })
    await flush(4000)
    expect(screen.getByRole('button', { name: "Open Dev's screen" })).not.toHaveAttribute('data-stale')
  })

  it('opens the Computer tab on click', async () => {
    const onPanel = vi.fn()
    render(header(null, onPanel))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: "Open Dev's screen" }))
    expect(onPanel).toHaveBeenCalledWith('computer')
  })
  it('opens the Computer tab from the control chip too, and truncates it', async () => {
    thumb = () => ({ data_url: null, suppressed: 'human_has_control' })
    const onPanel = vi.fn()
    render(header(null, onPanel))
    await flush()
    const chip = screen.getByRole('button', { name: 'Someone is in control' })
    expect(chip).toHaveClass('min-w-0', 'truncate')
    expect(chip).toHaveAttribute('title', 'Someone is in control')
    fireEvent.click(chip)
    expect(onPanel).toHaveBeenCalledWith('computer')
  })

  it('stops polling after an unmount and switches polling when the bot changes', async () => {
    const { rerender, unmount } = render(header())
    await flush()
    const before = thumbCalls().length
    rerender(<ChatHeader bot={bot({ name: 'ops', title: 'Ops' })} stale={false} panel={null} onPanel={() => undefined} />)
    await flush(0)
    await flush(8000)
    const profiles = thumbCalls().slice(before).map(c => c.params.profile)
    expect(profiles.length).toBeGreaterThan(0)
    expect(profiles.every(p => p === 'ops')).toBe(true)
    unmount()
    const after = thumbCalls().length
    await flush(20_000)
    expect(thumbCalls()).toHaveLength(after)
  })
})
