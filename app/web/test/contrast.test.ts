import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { compositeOver, contrastOf, contrastRatio, parseColor } from './contrast'

const css = readFileSync(resolve(__dirname, '../src/index.css'), 'utf8')

/** Every `--name: value;` declared directly in the block opened by `selector`. */
function declarations(selector: string): Record<string, string> {
  const start = css.indexOf(selector)
  if (start < 0) return {}
  const body = css.slice(start, css.indexOf('\n}', start))
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1]!, m[2]!.trim()]))
}

const lightTokens = declarations(':root {')
// Dark inherits whatever it does not redefine from :root (e.g. --watermelon).
const THEMES = { light: lightTokens, dark: { ...lightTokens, ...declarations(':root[data-theme="dark"] {') } }

const TEXT = 4.5
const NON_TEXT = 3
const SURFACES = ['background', 'shell', 'raised', 'control']

/** Dark is frozen (R13), so a pair that only light draws safely is measured in light alone. */
const LIGHT_ONLY = ['light']

/** [foreground token, surface tokens, minimum ratio, themes (all when left out)]: spec §5.1 review rule plus R13 and the light review. */
const RULES: [string, string[], number, string[]?][] = [
  ['foreground', SURFACES, TEXT],
  ['muted-foreground', SURFACES, TEXT],
  // Faint text never sits on --control (spec §5.1 ruling).
  ['faint', ['background', 'shell', 'raised'], TEXT],
  ['destructive', ['background', 'shell', 'raised'], TEXT],
  ['destructive', ['control'], TEXT, LIGHT_ONLY],
  // `text-background` on `bg-destructive` (the hidden-character marker in the approval card).
  ['background', ['destructive'], TEXT],
  ['primary-foreground', ['primary'], TEXT],
  // Also the unchosen radio ring (light review C1) and the sidebar focus ring.
  ['ring', SURFACES, NON_TEXT],
  // No class uses it today; dark keeps crew-bots' value (frozen), so only light is held to the ring rule.
  ['sidebar-ring', SURFACES, NON_TEXT, LIGHT_ONLY],
  ['status-working', SURFACES, NON_TEXT],
  ['status-waiting', SURFACES, NON_TEXT],
  ['status-idle', SURFACES, NON_TEXT],
  ['watermelon', ['background', 'shell', 'raised'], NON_TEXT],
  ['watermelon', ['control'], NON_TEXT, LIGHT_ONLY],
  // Control shapes (light review C2, I1): not WCAG text pairs, so the floor is the step the dark theme has.
  ['switch-off', ['background', 'shell'], 1.5],
  ['lifted', ['background'], 1.1],
  ['raised', ['shell'], 1.15],
  // The text tiers stay apart (light review I4).
  ['muted-foreground', ['faint'], 1.25]
]

/** A token's value with `var(--other)` followed to the colour it names. */
function valueOf(tokens: Record<string, string>, name: string, depth = 0): string | undefined {
  const value = tokens[`--${name}`]
  const ref = /^var\(--([\w-]+)\)$/.exec(value ?? '')
  return ref && depth < 5 ? valueOf(tokens, ref[1]!, depth + 1) : value
}

/** A missing or unparseable token yields 0, so the row fails with its name rather than breaking collection. */
function ratioOf(tokens: Record<string, string>, fg: string, bg: string): number {
  const a = valueOf(tokens, fg)
  const b = valueOf(tokens, bg)
  if (!a || !b) return 0
  try {
    return Math.floor(contrastRatio(a, b) * 100) / 100
  } catch {
    return 0
  }
}

/** [text token, fill token, fill alpha, surfaces under the fill, minimum]: class-map pairs with a translucent fill. */
const TINT_RULES: [string, string, number, string[], number, string[]?][] = [
  // `text-destructive` on `bg-destructive/10` (error badges, the destructive button).
  ['destructive', 'destructive', 0.1, ['background', 'shell', 'raised'], TEXT],
  ['destructive', 'destructive', 0.1, ['control'], TEXT, LIGHT_ONLY]
]

/** Like `ratioOf`, with `fill` at `alpha` composited over `under` as the background. */
function tintRatioOf(tokens: Record<string, string>, fg: string, fill: string, alpha: number, under: string): number {
  const [a, b, c] = [valueOf(tokens, fg), valueOf(tokens, fill), valueOf(tokens, under)]
  if (!a || !b || !c) return 0
  try {
    return Math.floor(contrastOf(parseColor(a), compositeOver(parseColor(b), alpha, parseColor(c))) * 100) / 100
  } catch {
    return 0
  }
}

const pairs = Object.entries(THEMES).flatMap(([theme, tokens]) =>
  RULES.filter(rule => rule[3]?.includes(theme) ?? true).flatMap(([fg, surfaces, min]) => surfaces.map(bg => ({ theme, fg, bg, min, ratio: ratioOf(tokens, fg, bg) }))))

const tintPairs = Object.entries(THEMES).flatMap(([theme, tokens]) =>
  TINT_RULES.filter(rule => rule[5]?.includes(theme) ?? true).flatMap(([fg, fill, alpha, surfaces, min]) =>
    surfaces.map(under => ({ theme, fg, bg: `${fill}/${alpha * 100} over ${under}`, min, ratio: tintRatioOf(tokens, fg, fill, alpha, under) }))))

describe('contrast check', () => {
  it('measures 21:1 for white on black and parses #ee2563', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5)
    expect(contrastRatio('oklch(1 0 0)', 'oklch(0 0 0)')).toBeCloseTo(21, 3)
    const watermelon = parseColor('#ee2563')
    expect(watermelon.r).toBeCloseTo(0.855, 3)
    expect(watermelon.g).toBeCloseTo(0.0185, 3)
    expect(watermelon.b).toBeCloseTo(0.1248, 3)
  })

  it('reads oklch the way the browser does', () => {
    // oklch(0.205 0 0) is #171717 and oklch(0.704 0.191 22.216) is #ff6467 in the browser.
    const grey = parseColor('oklch(0.205 0 0)')
    expect(grey.r).toBeCloseTo(parseColor('#171717').r, 3)
    expect(grey.g).toBeCloseTo(grey.b, 6)
    const red = parseColor('oklch(0.704 0.191 22.216)')
    const hex = parseColor('#ff6467')
    expect(red.r).toBeCloseTo(hex.r, 2)
    expect(red.g).toBeCloseTo(hex.g, 2)
    expect(red.b).toBeCloseTo(hex.b, 2)
  })

  it('refuses colours it cannot measure (alpha, color-mix, var)', () => {
    for (const value of ['oklch(1 0 0 / 10%)', 'color-mix(in oklab, red 50%, blue)', 'var(--x)', '#fff']) {
      expect(() => parseColor(value), value).toThrow()
    }
  })

  it('composites a translucent fill in gamma-encoded sRGB', () => {
    // 50% black over white is #808080 (0.5 gamma), not linear 0.5 (#bcbcbc).
    const grey = compositeOver(parseColor('#000000'), 0.5, parseColor('#ffffff'))
    expect(grey.r).toBeCloseTo(0.2140, 3)
    expect(contrastOf(compositeOver(parseColor('#000000'), 0, parseColor('#ffffff')), parseColor('#000000'))).toBeCloseTo(21, 5)
  })

  it.each([...pairs, ...tintPairs])('$theme: $fg on $bg is $ratio:1 (needs $min)', ({ ratio, min }) => {
    expect(ratio).toBeGreaterThanOrEqual(min)
  })
})
