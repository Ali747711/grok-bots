/**
 * WCAG contrast from CSS colour tokens, for the spec §5.1 review rule.
 * Reads only opaque `oklch(L C H)` and `#rrggbb`; alpha, `color-mix()` and `var()` are refused,
 * because their colour depends on what sits underneath.
 */

export interface LinearRgb {
  r: number
  g: number
  b: number
}

const OKLCH = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/
const HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i

const clamp = (n: number): number => Math.min(1, Math.max(0, n))

/** sRGB transfer function, inverted (gamma-encoded 0..1 → linear). */
const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

/** OKLCH → OKLab → LMS → linear sRGB (Björn Ottosson's matrices, as CSS Color 4 uses them). */
function oklchToLinear(l: number, c: number, hDeg: number): LinearRgb {
  const h = (hDeg * Math.PI) / 180
  const a = c * Math.cos(h)
  const b = c * Math.sin(h)
  const lc = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const mc = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const sc = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  return {
    r: clamp(4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc),
    g: clamp(-1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc),
    b: clamp(-0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc)
  }
}

/** A token value as linear sRGB, each channel clamped to 0..1. Throws on any other syntax. */
export function parseColor(value: string): LinearRgb {
  const text = value.trim()
  const oklch = OKLCH.exec(text)
  if (oklch) return oklchToLinear(Number(oklch[1]), Number(oklch[2]), Number(oklch[3]))
  const hex = HEX.exec(text)
  if (hex) {
    const [r, g, b] = [hex[1]!, hex[2]!, hex[3]!].map(part => toLinear(parseInt(part, 16) / 255))
    return { r: r!, g: g!, b: b! }
  }
  throw new Error(`cannot measure colour: ${value}`)
}

const luminance = ({ r, g, b }: LinearRgb): number => 0.2126 * r + 0.7152 * g + 0.0722 * b

/** WCAG 2 contrast ratio between two opaque colours (1..21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(parseColor(a)), luminance(parseColor(b))].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}
