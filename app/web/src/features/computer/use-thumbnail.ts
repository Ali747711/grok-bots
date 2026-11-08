import { useEffect, useState } from 'react'

import * as display from './display-client'

const REFRESH_MS = 4000
const STALE_AFTER = 3

export interface Thumbnail {
  /** The `data:image/jpeg` URL of the last good frame; null when there is nothing to show. */
  readonly src: string | null
  /** A human holds control, so Hermes withholds the frame (not a failure). */
  readonly suppressed: boolean
  /** Three polls in a row failed: the last frame may be out of date. */
  readonly stale: boolean
}

const NONE: Thumbnail = { src: null, suppressed: false, stale: false }

const usePageVisible = (): boolean => {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')
  useEffect(() => {
    const onChange = (): void => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  return visible
}

/**
 * Poll `display.thumbnail {profile}` every 4 s while `enabled` and the page is visible. The next poll
 * is scheduled after the previous one settles, so calls never overlap. A thumbnail does not keep the
 * screen alive (facts 4), so polling cannot defeat the idle stop.
 */
export function useThumbnail(profile: string, enabled: boolean): Thumbnail {
  const [thumb, setThumb] = useState<Thumbnail>(NONE)
  const visible = usePageVisible()
  const active = enabled && visible

  useEffect(() => {
    if (!enabled) setThumb(NONE)
    if (!active) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let misses = 0
    const poll = async (): Promise<void> => {
      try {
        const reply = await display.thumbnail(profile)
        if (cancelled) return
        misses = 0
        setThumb({ src: reply.data_url ?? null, suppressed: reply.suppressed === 'human_has_control', stale: false })
      } catch {
        if (cancelled) return
        misses += 1
        if (misses >= STALE_AFTER) setThumb(prev => ({ ...prev, stale: true }))
      }
      if (!cancelled) timer = setTimeout(() => void poll(), REFRESH_MS)
    }
    void poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [profile, enabled, active])

  return thumb
}
