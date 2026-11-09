import { useTheme } from '@/lib/use-theme'

const SKY = 'linear-gradient(180deg, #2a8af0 0%, #4ea4f6 55%, #bcdcfb 100%)'
const CLOUDS = [
  'radial-gradient(180px 60px at 18% 94%, rgba(255,255,255,.85), transparent 70%)',
  'radial-gradient(240px 75px at 55% 100%, rgba(255,255,255,.8), transparent 70%)',
  'radial-gradient(200px 68px at 88% 92%, rgba(255,255,255,.75), transparent 70%)',
  'radial-gradient(140px 45px at 75% 20%, rgba(255,255,255,.35), transparent 70%)'
].join(', ')

/** Decorative backdrop: the sky with soft clouds in light, a flat near-black in dark. */
export function SkyCanvas() {
  const flat = useTheme() === 'dark'
  return (
    <div
      aria-hidden="true"
      data-canvas=""
      data-variant={flat ? 'flat' : 'sky'}
      className="pointer-events-none fixed inset-0 -z-10"
      style={{ background: flat ? '#050505' : `${CLOUDS}, ${SKY}` }}
    />
  )
}
