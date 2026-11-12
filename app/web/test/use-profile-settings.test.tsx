import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ApprovalsView } from '@/features/profile/profile-api'
import { useProfileSettings } from '@/features/profile/use-profile-settings'

import { json, settingsRoutes, settingsState } from './profile-settings-stub'

const view = (mode: ApprovalsView['mode']): ApprovalsView => ({ mode, isDefault: false, sandboxed: false })
const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

/** The settings routes, with every approvals read held until the test answers it. */
function held() {
  const state = settingsState()
  const waiting: Array<(r: Response) => void> = []
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith('/approvals') && (init?.method ?? 'GET') === 'GET') return new Promise<Response>(resolve => waiting.push(resolve))
    return settingsRoutes(state, url, init) ?? json({})
  }))
  return waiting
}
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

afterEach(() => vi.unstubAllGlobals())

describe('useProfileSettings', () => {
  it('ignores an older reload that answers after a newer one', async () => {
    const waiting = held()
    const { result } = renderHook(() => useProfileSettings('scout'))
    await waitFor(() => expect(waiting).toHaveLength(1))
    act(() => void result.current.reload())
    await waitFor(() => expect(waiting).toHaveLength(2))

    waiting[1]!(answer(view('manual')))
    await waitFor(() => expect(result.current.approvals?.mode).toBe('manual'))
    // The first read answers last, with what Hermes held before: it must not come back on screen.
    waiting[0]!(answer(view('smart')))
    await settle()
    expect(result.current.approvals?.mode).toBe('manual')
    expect(result.current.screen).toEqual({ useScreen: false, idleStopMinutes: 15 })
  })

  it('ignores an older reload that fails after a newer one answered', async () => {
    const waiting = held()
    const { result } = renderHook(() => useProfileSettings('scout'))
    await waitFor(() => expect(waiting).toHaveLength(1))
    act(() => void result.current.reload())
    await waitFor(() => expect(waiting).toHaveLength(2))
    waiting[1]!(answer(view('manual')))
    await waitFor(() => expect(result.current.approvals?.mode).toBe('manual'))
    waiting[0]!(answer({ error: 'hermes_offline' }, 503))
    await settle()
    expect(result.current.errors.approvals).toBeNull()
  })

  it('keeps a written value over a reload that started before the write', async () => {
    const waiting = held()
    const { result } = renderHook(() => useProfileSettings('scout'))
    await waitFor(() => expect(waiting).toHaveLength(1))
    act(() => result.current.apply({ approvals: view('off') }))
    expect(result.current.approvals?.mode).toBe('off')
    waiting[0]!(answer(view('smart')))
    await settle()
    expect(result.current.approvals?.mode).toBe('off')
  })

  it('tells the caller which parts a reload could not read, and keeps the last values', async () => {
    const waiting = held()
    const { result } = renderHook(() => useProfileSettings('scout'))
    await waitFor(() => expect(waiting).toHaveLength(1))
    waiting[0]!(answer(view('manual')))
    await waitFor(() => expect(result.current.approvals?.mode).toBe('manual'))
    let errors: unknown
    await act(async () => {
      const reading = result.current.reload()
      await waitFor(() => expect(waiting).toHaveLength(2))
      waiting[1]!(answer({ error: 'hermes_offline' }, 503))
      errors = await reading
    })
    expect(errors).toEqual({ approvals: 'Hermes is offline', screen: null, apps: null })
    expect(result.current.approvals?.mode).toBe('manual')
  })
})
