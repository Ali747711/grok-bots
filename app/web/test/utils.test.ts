import { describe, expect, it } from 'vitest'

import { cn } from '@/lib/utils'

describe('cn', () => {
  it('merges the new colour tokens as conflicting classes', () => {
    expect(cn('bg-shell', 'bg-raised')).toBe('bg-raised')
    expect(cn('bg-raised', 'bg-control')).toBe('bg-control')
    expect(cn('bg-background', 'hover:bg-hover', 'bg-shell')).toBe('hover:bg-hover bg-shell')
    expect(cn('text-faint', 'text-muted-foreground')).toBe('text-muted-foreground')
    expect(cn('ring-watermelon', 'ring-ring')).toBe('ring-ring')
    expect(cn('bg-status-working', 'bg-status-waiting')).toBe('bg-status-waiting')
    expect(cn('text-status-error', 'text-destructive')).toBe('text-destructive')
  })

  it('keeps size and width classes beside the new colours', () => {
    expect(cn('text-xs', 'text-faint')).toBe('text-xs text-faint')
    expect(cn('ring-2', 'ring-watermelon')).toBe('ring-2 ring-watermelon')
    expect(cn('border', 'border-border', 'bg-status-idle')).toBe('border border-border bg-status-idle')
  })
})
