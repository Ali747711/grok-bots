import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(__dirname, '../src/index.css'), 'utf8')

const block = (selector: string): string => {
  const start = css.indexOf(selector)
  expect(start, selector).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf('\n}', start))
}
const light = block(':root {')
const dark = block(':root[data-theme="dark"] {')

describe('theme tokens', () => {
  it.each(['--contrast', '--contrast-foreground', '--contrast-border', '--contrast-muted', '--contrast-danger', '--ok-soft', '--ok-ink', '--warn-soft', '--warn-ink', '--danger-soft', '--danger-ink', '--contrast-line', '--sky', '--sky-ink', '--sky-soft', '--needs', '--radius-block'])('defines %s for light and dark', token => {
    if (token !== '--radius-block') expect(dark).toContain(`${token}:`)
    expect(light).toContain(`${token}:`)
  })

  it('uses lime as primary with black text, in both themes', () => {
    for (const scope of [light, dark]) {
      expect(scope).toMatch(/--primary:\s*#d6f55a/i)
      expect(scope).toMatch(/--primary-foreground:\s*#0d0d0d/i)
    }
  })

  it('uses the spec surfaces', () => {
    expect(light).toMatch(/--muted:\s*#f2f4f6/i)
    expect(dark).toMatch(/--muted:\s*#1d1f22/i)
    expect(dark).toMatch(/--card:\s*#131416/i)
    expect(dark).toMatch(/--contrast:\s*#000/i)
    expect(dark).toMatch(/--contrast-border:\s*#2c2f34/i)
  })

  it('exposes the Crew tokens as utilities and a mono label class', () => {
    for (const name of ['--color-contrast:', '--color-contrast-foreground:', '--color-contrast-border:', '--color-sky:', '--color-sky-soft:', '--color-needs:', '--radius-block:']) expect(css).toContain(name)
    expect(css).toContain('.label-mono')
    expect(css).toMatch(/letter-spacing:\s*\.12em/)
  })

  it('declares .label-mono in a layer so utilities can override it', () => {
    const at = css.indexOf('.label-mono')
    const before = css.slice(0, at)
    const opened = (before.match(/@layer components\s*\{/g) ?? []).length
    const utility = /@utility label-mono\s*\{/.test(css)
    const insideLayer = opened > 0 && before.lastIndexOf('@layer components') > before.lastIndexOf('\n}\n')
    expect(utility || insideLayer).toBe(true)
  })
})
