import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { act, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CrewState } from '@/state/types'

import { FakeClient } from './fake-client'
import { crewState } from './fixtures'

const client = new FakeClient()
vi.mock('@/chat/gateway', () => ({ connectGateway: () => client }))
const hook = vi.hoisted(() => ({ value: { state: null as CrewState | null, connected: true } }))
vi.mock('@/state/use-crew-state', () => ({ useCrewState: () => hook.value }))
vi.mock('bot-avatars', async () => {
  const actual = await vi.importActual<typeof import('bot-avatars')>('bot-avatars')
  return { ...actual, BotAvatar: () => <div data-testid="stub" /> }
})

const { default: App } = await import('@/App')

beforeEach(() => {
  hook.value = { state: crewState(), connected: true }
  client.handlers = { 'session.resume': () => ({ session_id: 'live-1', execution_generation: 1, running: false }) }
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ messages: [] }), { status: 200 }))))
})
const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
const flush = () => act(() => new Promise<void>(resolve => setTimeout(resolve, 0)))

describe('loading and empty states', () => {
  it('shows skeletons while state loads and a friendly empty roster', () => {
    hook.value = { state: null, connected: false }
    const { unmount } = renderAt('/')
    expect(within(screen.getByRole('complementary')).getAllByTestId('roster-skeleton').length).toBeGreaterThan(0)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    unmount()
    hook.value = { state: crewState({ bots: [] }), connected: true }
    renderAt('/needs-you')
    const roster = within(screen.getByRole('complementary'))
    expect(roster.getByText('No bots yet')).toBeInTheDocument()
    expect(roster.getByRole('button', { name: 'New bot' })).toBeInTheDocument()
    expect(roster.queryByTestId('roster-skeleton')).toBeNull()
  })

  it('shows a chat skeleton until the history is loaded', async () => {
    renderAt('/bots/dev')
    expect(screen.getByTestId('chat-skeleton')).toBeInTheDocument()
    await flush()
    expect(screen.queryByTestId('chat-skeleton')).toBeNull()
  })

  it.each([
    ['Hermes offline', { hermes: 'offline' as const }, true],
    ['Crew stream down', {}, false]
  ])('shows no chat skeleton while stale (%s)', (_label, over, connected) => {
    hook.value = { state: crewState(over), connected }
    renderAt('/bots/dev')
    expect(screen.queryByTestId('chat-skeleton')).toBeNull()
  })
})

const SRC = join(__dirname, '..', 'src')
const SKIP = [join('components', 'ui'), join('vendor')]

const PREFIX = '(?:bg|text|border|ring|outline|fill|stroke|shadow|divide|placeholder|from|via|to|decoration|accent|caret)'
const PALETTE = '(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)'
// A colour utility (with any variants) that names a palette shade, white/black, or an arbitrary hex.
const RAW_COLOUR = new RegExp(
  `(?<![\\w-])(?:[\\w\\[\\]=\\-:]+:)*${PREFIX}-(?:${PALETTE}-(?:50|100|200|300|400|500|600|700|800|900|950)|white|black|\\[(?:#|rgb|hsl|oklch)[^\\]]*\\])(?![\\w-])`,
  'g'
)

export const rawColours = (source: string): string[] => source.match(RAW_COLOUR) ?? []

// Colour literals outside class names (inline styles, canvas code): hex, rgb(), hsl(), oklch().
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/g
export const colourLiterals = (source: string): string[] => source.match(LITERAL) ?? []
// The only places that may hold colour data: the sky canvas gradient and the avatar swatches.
const LITERAL_ALLOWED = [join('layout', 'SkyCanvas.tsx'), join('features', 'avatars', 'avatar-model.ts')]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (SKIP.some(skip => relative(SRC, path).startsWith(skip))) return []
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

describe('theme tokens only', () => {
  it('catches planted raw colours but lets our tokens through', () => {
    const planted = rawColours('className="text-red-600 hover:bg-white dark:border-[#fff] data-checked:text-black/80"')
    expect(planted).toEqual(['text-red-600', 'hover:bg-white', 'dark:border-[#fff]', 'data-checked:text-black'])
    expect(rawColours('bg-[rgb(1,2,3)] text-[oklch(0.5_0_0)] bg-[hsl(0,0%,0%)] border-[#abc]')).toHaveLength(4)
    expect(rawColours('bg-sky text-sky-ink bg-sky-soft bg-needs bg-contrast text-contrast-foreground bg-ok-soft text-danger-ink border-contrast-line')).toEqual([])
  })

  it('catches planted colour literals', () => {
    expect(colourLiterals("style={{ color: '#f00', background: 'rgb(1,2,3)', fill: 'oklch(0.5 0 0)', stroke: 'hsl(0 0% 0%)' }}")).toHaveLength(4)
    expect(colourLiterals("const url = '/login#ticket=abc' // not a colour")).toEqual([])
  })

  it('keeps colour literals to the sky canvas and the avatar swatches', () => {
    const hits = sourceFiles(SRC)
      .filter(file => !LITERAL_ALLOWED.includes(relative(SRC, file)))
      .flatMap(file => colourLiterals(readFileSync(file, 'utf8')).map(hit => `${relative(SRC, file)}: ${hit}`))
    expect(hits).toEqual([])
  })

  it('uses only theme tokens outside components/ui', () => {
    const hits = sourceFiles(SRC).flatMap(file => rawColours(readFileSync(file, 'utf8')).map(hit => `${relative(SRC, file)}: ${hit}`))
    expect(hits).toEqual([])
  })
})

describe('a bot that has not arrived yet', () => {
  const tree = () => <MemoryRouter initialEntries={['/bots/fresh']}><App /></MemoryRouter>
  const withFresh = () => crewState({ bots: [...crewState().bots, { ...crewState().bots[0]!, name: 'fresh', title: 'Fresh', isPrimary: false }] })

  it('waits for the next state instead of flashing "Bot not found"', async () => {
    const { rerender } = render(tree())
    expect(screen.queryByText('Bot not found')).toBeNull()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    hook.value = { state: withFresh(), connected: true }
    rerender(tree())
    expect(screen.queryByText('Bot not found')).toBeNull()
    expect(await screen.findByRole('heading', { name: 'Fresh' })).toBeInTheDocument()
  })

  it('says "Bot not found" once a state arrives without it', () => {
    const { rerender } = render(tree())
    hook.value = { state: { ...crewState() }, connected: true }
    rerender(tree())
    expect(screen.getByText('Bot not found')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to your bots' })).toHaveAttribute('href', '/')
  })

  it('says "Bot not found" after the grace period with no update', () => {
    vi.useFakeTimers()
    render(tree())
    expect(screen.queryByText('Bot not found')).toBeNull()
    act(() => { vi.advanceTimersByTime(3100) })
    expect(screen.getByText('Bot not found')).toBeInTheDocument()
    vi.useRealTimers()
  })
})
