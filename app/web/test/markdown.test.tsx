import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Markdown } from '@/features/chat/Markdown'

describe('Markdown', () => {
  it('renders html as text and drops javascript links', () => {
    render(<Markdown text={'<img src=x onerror=alert(1)> [a](javascript:alert(1)) [b](https://ok.example)'} />)
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByText('a').closest('a')?.getAttribute('href') ?? '').not.toMatch(/javascript/)
    expect(screen.getByText('b').closest('a')?.getAttribute('href')).toBe('https://ok.example')
  })

  it('opens links safely in a new tab', () => {
    render(<Markdown text="[b](https://ok.example)" />)
    const link = screen.getByText('b').closest('a')!
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('allows mailto but not data: or relative links', () => {
    render(<Markdown text="[m](mailto:a@b.co) [d](data:text/html,x) [r](/crew/state)" />)
    expect(screen.getByText('m').closest('a')?.getAttribute('href')).toBe('mailto:a@b.co')
    for (const label of ['d', 'r']) expect(screen.getByText(label).closest('a')?.getAttribute('href') ?? '').toBe('')
  })

  it('renders code blocks and lists', () => {
    render(<Markdown text={'- one\n- two\n\n```\necho hi\n```'} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('echo hi').tagName).toBe('CODE')
  })
})
