import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Shell } from '@/layout/Shell'

const parts = { sidebar: <div>side</div>, main: <div>chat</div>, panel: <div>right</div> }

describe('Shell', () => {
  it('renders sidebar and main without the panel when closed', () => {
    render(<Shell {...parts} panelOpen={false} />)
    expect(screen.getByRole('complementary', { name: 'Sidebar' })).toHaveTextContent('side')
    expect(screen.getByRole('main')).toHaveTextContent('chat')
    expect(screen.queryByRole('region', { name: 'Panel' })).toBeNull()
    expect(screen.queryByText('right')).toBeNull()
  })

  it('renders the panel when open', () => {
    render(<Shell {...parts} panelOpen />)
    expect(screen.getByRole('region', { name: 'Panel' })).toHaveTextContent('right')
  })
})
