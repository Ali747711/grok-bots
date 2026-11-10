import { vi } from 'vitest'

import type { ApprovalsView } from '@/features/profile/profile-api'

export const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))

export interface SettingsState {
  approvals: ApprovalsView
  screen: { useScreen: boolean; idleStopMinutes: number | null }
  apps: number
  /** An answer for the next write to a route (`PUT <path tail>`), instead of applying it. */
  fail: Record<string, () => Promise<Response>>
  /** An answer for every read of a route (`GET <path tail>`). */
  failRead: Record<string, () => Promise<Response>>
}

export const settingsState = (over: Partial<SettingsState> = {}): SettingsState => ({
  approvals: { mode: 'smart', isDefault: true, sandboxed: false },
  screen: { useScreen: false, idleStopMinutes: 15 },
  apps: 0,
  fail: {},
  failRead: {},
  ...over
})

/**
 * The three settings routes of one bot as a small stateful server: a PUT changes what the next GET
 * returns, so a test proves the row shows what was re-read, not what was clicked. Returns null for
 * any other URL.
 */
export function settingsRoutes(state: SettingsState, url: string, init?: RequestInit): Promise<Response> | null {
  const tail = /^\/crew\/bots\/[^/]+\/(approvals|screen\/config|apps)$/.exec(url)?.[1]
  if (!tail) return null
  const method = init?.method ?? 'GET'
  if (method === 'GET') {
    const failed = state.failRead[tail]
    if (failed) return failed()
    if (tail === 'approvals') return json(state.approvals)
    if (tail === 'screen/config') return json(state.screen)
    return json({ apps: Array.from({ length: state.apps }, (_, i) => ({ toolkit: `app${i}`, level: 'read' })), offered: ['read'], asks: true, keyConfigured: true, roomWritesDeclined: false })
  }
  const failed = state.fail[tail]
  if (failed) return failed()
  const body = JSON.parse(String(init?.body)) as Record<string, unknown>
  if (tail === 'approvals') {
    state.approvals = { ...state.approvals, mode: body.mode as ApprovalsView['mode'], isDefault: false }
    return json(state.approvals)
  }
  if (tail === 'screen/config') {
    state.screen = { ...state.screen, ...body }
    return json(state.screen)
  }
  return json({})
}

/** Stub `fetch` with only the settings routes; everything else answers `{}`. */
export function stubSettings(state: SettingsState) {
  const fn = vi.fn((url: string, init?: RequestInit) => settingsRoutes(state, url, init) ?? json({}))
  vi.stubGlobal('fetch', fn)
  return fn
}

type Stub = ReturnType<typeof stubSettings>
/** The bodies of the PUTs sent to a settings route, in order. */
export const puts = (fn: Stub, tail: string) =>
  fn.mock.calls.filter(([u, i]) => u.endsWith(`/${tail}`) && i?.method === 'PUT').map(([, i]) => JSON.parse(String(i?.body)) as unknown)
export const reads = (fn: Stub, tail: string) => fn.mock.calls.filter(([u, i]) => u.endsWith(`/${tail}`) && (i?.method ?? 'GET') === 'GET').length
