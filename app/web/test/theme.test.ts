import { afterEach, describe, expect, it, vi } from 'vitest'

import { applySystemTheme } from '@/lib/theme'

type Listener = (e: { matches: boolean }) => void

function stubMatchMedia(matches: boolean) {
  const listeners = new Set<Listener>()
  const mql = {
    matches,
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l)
  }
  vi.stubGlobal('matchMedia', vi.fn(() => mql))
  return { emit: (m: boolean) => listeners.forEach(l => l({ matches: m })), listeners }
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete document.documentElement.dataset.theme
})

describe('applySystemTheme', () => {
  it('sets dark from the OS preference and follows changes', () => {
    const media = stubMatchMedia(true)
    applySystemTheme()
    expect(document.documentElement.dataset.theme).toBe('dark')
    media.emit(false)
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('stops following after the returned cleanup runs', () => {
    const media = stubMatchMedia(false)
    const stop = applySystemTheme()
    expect(document.documentElement.dataset.theme).toBe('light')
    stop()
    expect(media.listeners.size).toBe(0)
  })
})
