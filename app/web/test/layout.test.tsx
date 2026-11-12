import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { MessageList } from '@/features/chat/MessageList'
import { Shell } from '@/layout/Shell'
import type { ChatItem } from '@/chat/types'

const hasClasses = (el: Element, ...classes: string[]) => classes.every(c => el.classList.contains(c))

describe('layout: only the transcript scrolls', () => {
  it('shell fills the viewport and clips overflow, with min-h-0 panels', () => {
    const { container } = render(<Shell rail={<i />} main={<i />} side={<i />} />)
    expect(hasClasses(container.firstElementChild!, 'flex', 'h-dvh', 'overflow-hidden')).toBe(true)
    expect(hasClasses(screen.getByRole('complementary'), 'min-h-0', 'overflow-y-auto')).toBe(true)
    expect(hasClasses(screen.getByRole('main'), 'min-h-0', 'min-w-0', 'overflow-hidden')).toBe(true)
    expect(hasClasses(screen.getByRole('region', { name: 'Panel' }), 'min-h-0', 'min-w-0', 'overflow-y-auto')).toBe(true)
  })

  it('the transcript is the scroll container', () => {
    render(<MessageList items={[]} />)
    expect(hasClasses(screen.getByTestId('transcript'), 'flex-1', 'min-h-0', 'overflow-y-auto')).toBe(true)
  })
})

describe('MessageList auto-scroll (on the transcript element)', () => {
  afterEach(() => {
    delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight
  })
  const stubHeights = (scrollHeight: number, clientHeight: number) => {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => scrollHeight })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => clientHeight })
  }
  const item = (n: number): ChatItem => ({ kind: 'assistant', id: `a${n}`, text: `m${n}` })

  it('follows new content', () => {
    stubHeights(1000, 400)
    const { rerender } = render(<MessageList items={[item(1)]} />)
    rerender(<MessageList items={[item(1), item(2)]} />)
    expect(screen.getByTestId('transcript').scrollTop).toBe(1000)
  })

  it('stays put once the reader scrolled up', () => {
    stubHeights(1000, 400)
    const { rerender } = render(<MessageList items={[item(1)]} />)
    const el = screen.getByTestId('transcript')
    el.scrollTop = 100
    fireEvent.scroll(el)
    rerender(<MessageList items={[item(1), item(2)]} />)
    expect(el.scrollTop).toBe(100)
  })
})
