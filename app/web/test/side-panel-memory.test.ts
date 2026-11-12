import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SIDE_PANEL_KEY, readSidePanel, rememberSidePanel } from '@/app/side-panel-memory'

beforeEach(() => window.localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('side-panel memory', () => {
  it('starts closed and never throws when storage is blocked', () => {
    expect(readSidePanel()).toBeNull()
    const blocked = () => { throw new DOMException('blocked', 'SecurityError') }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked)
    expect(readSidePanel()).toBeNull()
    expect(() => rememberSidePanel('computer')).not.toThrow()
    expect(() => rememberSidePanel(null)).not.toThrow()
    expect(readSidePanel()).toBeNull()
  })

  it('remembers computer, routines and none', () => {
    rememberSidePanel('computer')
    expect(window.localStorage.getItem(SIDE_PANEL_KEY)).toBe('computer')
    expect(readSidePanel()).toBe('computer')
    rememberSidePanel('routines')
    expect(readSidePanel()).toBe('routines')
    rememberSidePanel(null)
    expect(window.localStorage.getItem(SIDE_PANEL_KEY)).toBe('none')
    expect(readSidePanel()).toBeNull()
  })

  it('reads anything else in storage as closed', () => {
    for (const value of ['profile', 'group', 'COMPUTER', '']) {
      window.localStorage.setItem(SIDE_PANEL_KEY, value)
      expect(readSidePanel()).toBeNull()
    }
  })
})
