import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChatHeader } from '@/features/chat/ChatHeader'
import { CreditPill } from '@/features/usage/CreditPill'

import { bot } from './fixtures'

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('CreditPill', () => {
  it('shows the remaining credit with two decimals', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ state: 'ok', limit: 5, used: 3.18, remaining: 1.82, checkedAt: 1 })))
    render(<CreditPill />)
    await settle()
    expect(screen.getByText('$1.82 credit left')).toBeInTheDocument()
  })

  it('shows credit unknown when unavailable, when remaining is null, or when the call fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ state: 'unavailable', limit: null, used: null, remaining: null, checkedAt: null })))
    const a = render(<CreditPill />)
    await settle()
    expect(screen.getByText('credit unknown')).toBeInTheDocument()
    a.unmount()
    vi.stubGlobal('fetch', vi.fn(() => json({ state: 'ok', limit: null, used: 1, remaining: null, checkedAt: 1 })))
    const b = render(<CreditPill />)
    await settle()
    expect(screen.getByText('credit unknown')).toBeInTheDocument()
    b.unmount()
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('x'))))
    render(<CreditPill />)
    await settle()
    expect(screen.getByText('credit unknown')).toBeInTheDocument()
  })

  it('marks stale values', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ state: 'stale', limit: 5, used: 3, remaining: 2, checkedAt: 1 })))
    render(<CreditPill />)
    await settle()
    expect(screen.getByText('$2.00 credit left')).toBeInTheDocument()
    expect(screen.getByText('(stale)')).toBeInTheDocument()
  })

  it('refreshes every 60 s and stops on unmount', async () => {
    const fetchMock = vi.fn(() => json({ state: 'ok', limit: 5, used: 3, remaining: 2, checkedAt: 1 }))
    vi.stubGlobal('fetch', fetchMock)
    const { unmount } = render(<CreditPill />)
    await settle()
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('ChatHeader spend estimate', () => {
  const dev = bot({ name: 'dev', title: 'Dev', sessionId: 'tip-1' })

  it('shows the estimate from the session, fetched with the profile', async () => {
    const fetchMock = vi.fn((_url: string) => json({ estimated_cost_usd: 1, actual_cost_usd: 0.0412 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ChatHeader bot={dev} stale={false} />)
    await settle()
    expect(screen.getByText('≈ $0.04 (estimate)')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/sessions/tip-1?profile=dev')
  })

  it('prefers the actual cost, falls back to the estimate, and shows nothing without a number', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ estimated_cost_usd: 0.5, actual_cost_usd: null })))
    const a = render(<ChatHeader bot={dev} stale={false} />)
    await settle()
    expect(screen.getByText('≈ $0.50 (estimate)')).toBeInTheDocument()
    a.unmount()
    vi.stubGlobal('fetch', vi.fn(() => json({ messages: [] })))
    render(<ChatHeader bot={dev} stale={false} />)
    await settle()
    expect(screen.queryByText(/estimate/)).toBeNull()
  })

  it('does not fetch or show anything without a session id', async () => {
    const fetchMock = vi.fn(() => json({}))
    vi.stubGlobal('fetch', fetchMock)
    render(<ChatHeader bot={bot({ name: 'dev', sessionId: null })} stale={false} />)
    await settle()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refreshes when the bot goes from working to idle', async () => {
    let cost = 0.01
    const fetchMock = vi.fn(() => json({ estimated_cost_usd: cost }))
    vi.stubGlobal('fetch', fetchMock)
    const { rerender } = render(<ChatHeader bot={{ ...dev, status: 'working' }} stale={false} />)
    await settle()
    expect(screen.getByText('≈ $0.01 (estimate)')).toBeInTheDocument()
    cost = 0.09
    rerender(<ChatHeader bot={{ ...dev, status: 'idle' }} stale={false} />)
    await settle()
    expect(screen.getByText('≈ $0.09 (estimate)')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
