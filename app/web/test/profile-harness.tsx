import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { vi } from 'vitest'

import type { BotDetail } from '@/features/bots/types'
import { ProfilePage } from '@/features/profile/ProfilePage'
import type { BotView } from '@/state/types'

import { bot } from './fixtures'
import { type SettingsState, json, settingsRoutes, settingsState } from './profile-settings-stub'

export { json }

export const MODELS = { providers: [{ slug: 'openrouter', name: 'OpenRouter', is_current: true, models: ['a/one', 'b/two'] }], model: 'a/one', provider: 'openrouter' }
export const detail = (over: Partial<BotDetail> = {}): BotDetail => ({
  name: 'dev', isPrimary: false, title: 'Dev', look: { shape: 'squircle', color: '#6366f1', imageKind: 'shape' }, avatar: null, hidden: false, pinned: false, role: null,
  description: 'Does dev', soul: 'Be nice', model: { provider: 'openrouter', model: 'a/one' }, metaRevision: 3, ...over
})

export interface ProfileRoutes {
  models?: () => Promise<Response>
  /** `GET /crew/bots/<name>`; gets the bot's name. */
  get?: (name: string) => Promise<Response>
  patch?: (body: unknown) => Promise<Response>
  del?: () => Promise<Response>
  other?: Record<string, () => Promise<Response>>
  settings?: SettingsState
}

/** Crew as the profile sees it: the bot routes, the model list and the stateful settings routes. */
export function stub(r: ProfileRoutes = {}) {
  const settings = r.settings ?? settingsState()
  const fn = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (url === '/api/model/options') return (r.models ?? (() => json(MODELS)))()
    const other = r.other?.[`${method} ${url}`]
    if (other) return other()
    const name = /^\/crew\/bots\/([^/]+)$/.exec(url)?.[1]
    if (name) {
      if (method === 'PATCH') return (r.patch ?? (() => json({ status: 'saved', detail: detail() })))(JSON.parse(String(init?.body)))
      if (method === 'DELETE') return (r.del ?? (() => Promise.resolve(new Response(null, { status: 204 }))))()
      return (r.get ?? (() => json(detail())))(name)
    }
    return settingsRoutes(settings, url, init) ?? json({})
  })
  vi.stubGlobal('fetch', fn)
  return fn
}
type Stub = ReturnType<typeof stub>
export const patches = (fn: Stub) => fn.mock.calls.filter(([, init]) => init?.method === 'PATCH').map(([, init]) => JSON.parse(String(init?.body)) as unknown)
export const gets = (fn: Stub) => fn.mock.calls.filter(([u, i]) => u === '/crew/bots/dev' && (i?.method ?? 'GET') === 'GET').length

function Where() {
  const { pathname, search } = useLocation()
  return <div data-testid="where">{pathname + search}</div>
}
export const where = () => screen.getByTestId('where').textContent

export type Tab = 'identity' | 'avatar' | 'soul' | 'skills' | 'apps' | 'advanced'
export const dev = (over: Partial<BotView> = {}) => bot({ name: 'dev', title: 'Dev', ...over })

/** The profile as the app mounts it: keyed by bot, at `/bots/<name>?panel=profile[&tab=]`. */
export const tree = (b: BotView = dev(), tab?: Tab) => (
  <MemoryRouter key={b.name} initialEntries={[`/bots/${b.name}?panel=profile${tab ? `&tab=${tab}` : ''}`]}>
    <Routes>
      <Route path="*" element={<><ProfilePage key={b.name} bot={b} onBack={() => undefined} /><Where /></>} />
    </Routes>
  </MemoryRouter>
)
export const open = (b: BotView = dev(), tab?: Tab) => render(tree(b, tab))
/** The profile has loaded once its tabs are there. */
export const loaded = () => screen.findByRole('tab', { name: 'Identity' })
export const goTab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }))
export const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
/** Base UI only commits an option click that started with a pointer-down on it. */
export const pick = (label: string, option: string) => {
  fireEvent.click(screen.getByRole('combobox', { name: label }))
  const item = screen.getByRole('option', { name: option })
  fireEvent.pointerDown(item)
  fireEvent.click(item)
}
export const saveButton = () => screen.queryByRole('button', { name: 'Save' })
export const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }))
