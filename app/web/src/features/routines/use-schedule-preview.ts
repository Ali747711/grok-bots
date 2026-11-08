import { useEffect, useState } from 'react'

import { CrewApiError, previewRoutine } from './routines-api'
import type { ScheduleSpec } from './types'

const DEBOUNCE_MS = 300

export interface Preview {
  readonly next: readonly number[] | null
  readonly error: string | null
}

/** Next run times for a schedule, asked 300 ms after the last change. A failure is text, never a throw. */
export function useSchedulePreview(schedule: ScheduleSpec, timezone: string): Preview {
  const [preview, setPreview] = useState<Preview>({ next: null, error: null })
  const key = JSON.stringify(schedule)

  useEffect(() => {
    let active = true
    const timer = setTimeout(() => {
      previewRoutine(JSON.parse(key) as ScheduleSpec, timezone).then(
        next => active && setPreview({ next, error: null }),
        (e: unknown) => {
          const message = e instanceof CrewApiError && typeof e.body?.message === 'string' ? e.body.message : "Couldn't work out the next runs"
          if (active) setPreview({ next: null, error: message })
        }
      )
    }, DEBOUNCE_MS)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [key, timezone])

  return preview
}

export const formatInZone = (ms: number, timezone: string | null | undefined): string =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', ...(timezone ? { timeZone: timezone } : {}) }).format(ms)
