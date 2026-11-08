import type { RunView } from './types'

export const STATUS_WORD: Record<RunView['status'], string> = {
  running: 'Running', completed: 'Done', failed: 'Failed', cancelled: 'Cancelled', missed: 'Missed'
}

/** "2 s", "3 min", "1 h 5 min"; "running…" while it runs; empty when a run never ended (missed). */
export function durationText(run: Pick<RunView, 'startedAt' | 'endedAt' | 'status'>): string {
  if (run.endedAt === null) return run.status === 'running' ? 'running…' : ''
  const seconds = Math.max(0, Math.round((run.endedAt - run.startedAt) / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const rest = minutes % 60
  return rest === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${rest} min`
}
