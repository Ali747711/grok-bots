import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { draftKey, useDraft } from '@/features/chat/draft-store'

function Box({ id }: { id: string }) {
  const [text, setText] = useDraft(id)
  return <textarea aria-label={id} value={text} onChange={e => setText(e.target.value)} />
}

afterEach(() => vi.restoreAllMocks())

describe('draft store', () => {
  it('names bot and group drafts apart', () => {
    expect(draftKey.bot('dev')).toBe('bot:dev')
    expect(draftKey.group('dev')).toBe('group:dev')
  })

  it('keeps a draft per key across unmount and remount and writes nothing to localStorage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const first = render(<Box id={draftKey.bot('dev')} />)
    fireEvent.change(screen.getByLabelText('bot:dev'), { target: { value: 'half a thought' } })
    first.unmount()

    render(<><Box id={draftKey.bot('dev')} /><Box id={draftKey.bot('researcher')} /><Box id={draftKey.group('dev')} /></>)
    expect(screen.getByLabelText('bot:dev')).toHaveValue('half a thought')
    expect(screen.getByLabelText('bot:researcher')).toHaveValue('')
    expect(screen.getByLabelText('group:dev')).toHaveValue('')
    expect(setItem).not.toHaveBeenCalled()
    expect(window.localStorage.length + window.sessionStorage.length).toBe(0)
  })

  it('shows one draft in every box that reads the same key, and clears it', () => {
    render(<><Box id="bot:a" /><div data-testid="twin"><Box id="bot:a" /></div></>)
    const [one, two] = screen.getAllByLabelText('bot:a')
    act(() => { fireEvent.change(one!, { target: { value: 'x' } }) })
    expect(two).toHaveValue('x')
    act(() => { fireEvent.change(two!, { target: { value: '' } }) })
    expect(one).toHaveValue('')
  })
})
