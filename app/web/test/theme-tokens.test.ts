import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC = resolve(__dirname, '../src')
const css = readFileSync(join(SRC, 'index.css'), 'utf8')

const block = (selector: string): string => {
  const start = css.indexOf(selector)
  expect(start, selector).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf('\n}', start))
}
const light = block(':root {')
const dark = block(':root[data-theme="dark"] {')

/** The value of `--name` declared in a block, or undefined. */
const token = (scope: string, name: string): string | undefined =>
  new RegExp(`${name}:\\s*([^;]+);`).exec(scope)?.[1]?.trim()

/** OKLCH lightness of an achromatic `oklch(L 0 0)` token. */
const lightness = (scope: string, name: string): number => {
  const match = /^oklch\(([\d.]+)\s/.exec(token(scope, name) ?? '')
  expect(match, name).not.toBeNull()
  return Number(match![1])
}

const LADDER = ['--background', '--shell', '--raised', '--control', '--hover', '--faint']
const STATUS = ['--status-working', '--status-waiting', '--status-idle']

/** crew-bots' `.dark` block (CB/index.css). Only `--muted-foreground` and `--ring` may differ (R13). */
const CREW_BOTS_DARK: Record<string, string> = {
  '--background': 'oklch(0.145 0 0)',
  '--foreground': 'oklch(0.985 0 0)',
  '--card': 'oklch(0.205 0 0)',
  '--card-foreground': 'oklch(0.985 0 0)',
  '--popover': 'oklch(0.205 0 0)',
  '--popover-foreground': 'oklch(0.985 0 0)',
  '--primary': 'oklch(0.922 0 0)',
  '--primary-foreground': 'oklch(0.205 0 0)',
  '--secondary': 'oklch(0.269 0 0)',
  '--secondary-foreground': 'oklch(0.985 0 0)',
  '--muted': 'oklch(0.269 0 0)',
  '--accent': 'oklch(0.269 0 0)',
  '--accent-foreground': 'oklch(0.985 0 0)',
  '--destructive': 'oklch(0.704 0.191 22.216)',
  '--border': 'oklch(1 0 0 / 10%)',
  '--input': 'oklch(1 0 0 / 15%)',
  '--chart-1': 'oklch(0.87 0 0)',
  '--chart-2': 'oklch(0.556 0 0)',
  '--chart-3': 'oklch(0.439 0 0)',
  '--chart-4': 'oklch(0.371 0 0)',
  '--chart-5': 'oklch(0.269 0 0)',
  '--sidebar': 'oklch(0.205 0 0)',
  '--sidebar-foreground': 'oklch(0.985 0 0)',
  '--sidebar-primary': 'oklch(0.488 0.243 264.376)',
  '--sidebar-primary-foreground': 'oklch(0.985 0 0)',
  '--sidebar-accent': 'oklch(0.269 0 0)',
  '--sidebar-accent-foreground': 'oklch(0.985 0 0)',
  '--sidebar-border': 'oklch(1 0 0 / 10%)',
  '--sidebar-ring': 'oklch(0.556 0 0)',
  '--shell': 'oklch(0.205 0 0)',
  '--raised': 'oklch(0.269 0 0)',
  '--control': 'oklch(0.371 0 0)',
  '--hover': 'color-mix(in oklab, var(--raised) 55%, var(--shell))',
  '--faint': 'oklch(0.65 0 0)',
  '--status-working': 'oklch(0.765 0.177 163.223)',
  '--status-waiting': 'oklch(0.828 0.189 84.429)',
  '--status-idle': 'oklch(0.708 0 0)'
}

describe('theme tokens', () => {
  it('defines the crew-bots ladder, accent and status tokens in both themes', () => {
    for (const name of [...LADDER, ...STATUS]) {
      expect(token(light, name), `light ${name}`).toBeDefined()
      expect(token(dark, name), `dark ${name}`).toBeDefined()
    }
    expect(token(light, '--status-error')).toBe('var(--destructive)')
    expect(token(light, '--watermelon')).toBe('#ee2563')
    for (const name of ['shell', 'raised', 'control', 'hover', 'faint', 'watermelon', 'status-working', 'status-waiting', 'status-error', 'status-idle']) {
      expect(css, name).toContain(`--color-${name}: var(--${name});`)
    }
  })

  it('keeps the dark surfaces, accent and status colours exactly as crew-bots', () => {
    for (const [name, value] of Object.entries(CREW_BOTS_DARK)) expect(token(dark, name), name).toBe(value)
    // The accent is declared once in :root and never redefined for dark.
    expect(token(dark, '--watermelon')).toBeUndefined()
  })

  it('orders the light ladder: shell lightest, then canvas, raised, control', () => {
    const [background, shell, raised, control] = ['--background', '--shell', '--raised', '--control'].map(name => lightness(light, name))
    // Monotonic (light review I2): shell, canvas, raised, control. A well is never between raised and control.
    expect(shell).toBeGreaterThan(background!)
    expect(background).toBeGreaterThan(raised!)
    expect(raised).toBeGreaterThan(control!)
    expect(token(light, '--hover')).toBe('color-mix(in oklab, var(--control) 50%, var(--raised))')
  })

  it('maps the light-only helpers back to the old dark values (light review C2, I1, I3)', () => {
    expect(token(dark, '--lifted')).toBe('var(--raised)')
    expect(token(dark, '--switch-off')).toBe('var(--control)')
    expect(token(dark, '--field-border')).toBe('transparent')
    // Never `none`: it would void the whole composed box-shadow, focus rings included.
    expect(token(dark, '--lifted-shadow')).toBe('0 0 #0000')
    for (const name of ['lifted', 'switch-off', 'field-border']) expect(css, name).toContain(`--color-${name}: var(--${name});`)
    expect(css).toContain('--shadow-lifted: var(--lifted-shadow);')
  })

  it('gives light panels a soft shadow that dark does without', () => {
    expect(token(light, '--panel-shadow')).toMatch(/,/)
    expect(token(dark, '--panel-shadow')).toBe('none')
    expect(css).toMatch(/@utility shadow-panel\s*\{\s*box-shadow:\s*var\(--panel-shadow\);/)
  })

  it('sets color-scheme, the data-theme dark variant and Inter, and has no Sky token, label-mono or Geist', () => {
    expect(light).toMatch(/color-scheme:\s*light/)
    expect(dark).toMatch(/color-scheme:\s*dark/)
    expect(css).toContain('@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));')
    expect(css).toContain("--font-sans: 'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;")
    expect(css).toContain("--font-mono: ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace;")
    expect(css).not.toMatch(/--(sky|contrast|needs|ok-|warn-|danger-|radius-block)/)
    expect(css).not.toMatch(/label-mono|Geist/)

    const main = readFileSync(join(SRC, 'main.tsx'), 'utf8')
    expect(main).toContain("import '@fontsource-variable/inter'")
    expect(main).not.toMatch(/geist/i)
    const pkg = readFileSync(resolve(SRC, '../package.json'), 'utf8')
    expect(pkg).toContain('"@fontsource-variable/inter"')
    expect(pkg).toContain('"motion"')
    expect(pkg).not.toMatch(/geist/i)
    expect(existsSync(join(SRC, 'layout', 'SkyCanvas.tsx'))).toBe(false)
  })

  it('leaves no retired class or translucent focus ring anywhere in src', () => {
    const RETIRED = new RegExp(
      [
        '(?<![\\w-])(?:bg|text|ring|border|shadow|outline|fill|stroke|divide)-(?:sky|contrast|needs|ok|warn|danger)\\b',
        'var\\(--sky\\)',
        'label-mono',
        'rounded-block',
        'contrast-outline',
        'bg-card/95',
        '(?:ring|outline)-ring/\\d'
      ].join('|'),
      'g'
    )
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return entry.name === 'vendor' ? [] : files(path)
      return /\.(tsx?|css)$/.test(entry.name) ? [path] : []
    })
    const hits = files(SRC).flatMap(file => (readFileSync(file, 'utf8').match(RETIRED) ?? []).map(hit => `${relative(SRC, file)}: ${hit}`))
    expect(hits).toEqual([])
  })

  it('keeps destructive text opaque and off translucent destructive fills in the ui primitives (PF31)', () => {
    const dir = join(SRC, 'components', 'ui')
    const hits = readdirSync(dir).flatMap(name =>
      (readFileSync(join(dir, name), 'utf8').match(/(?:bg|text)-destructive\/\d+/g) ?? []).map(hit => `${name}: ${hit}`)
    )
    expect(hits).toEqual([])
  })
})
