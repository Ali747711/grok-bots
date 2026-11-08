import { useState } from 'react'

import { cn } from '@/lib/utils'

import { durationText, STATUS_WORD } from './run-format'
import { RunTranscript } from './RunTranscript'
import type { RunView } from './types'
import { useRuns } from './use-runs'
import { formatInZone } from './use-schedule-preview'

interface RunHistoryProps {
  bot: string
  routineId: string
  /** The routine's zone; start times are shown in it. */
  timezone: string | null
  /** The routine's own instruction, shown in place of Hermes's cron preamble. */
  instruction: string
  /** Changes when a run was just started, to re-read at once. */
  refreshKey?: number
}

/** Run titles carry Hermes's `[bot:<name>]` tag; it is internal. */
const cleanTitle = (title: string) => title.replace(/^\[bot:[a-z0-9][a-z0-9_-]*\]\s*/, '')

function RunSummary({ run, timezone }: { run: RunView; timezone: string | null }) {
  const bad = run.status === 'failed' || run.status === 'missed'
  return (
    <>
      <span className="flex items-center gap-2">
        <span className={cn('rounded-full bg-secondary px-1.5 text-xs', bad && 'text-destructive')}>{STATUS_WORD[run.status]}</span>
        <span className="text-xs text-muted-foreground">{formatInZone(run.startedAt, timezone)}</span>
        <span className="ml-auto text-xs text-muted-foreground">{durationText(run)}</span>
      </span>
      {run.error && <span className="block text-xs text-destructive">{run.error}</span>}
    </>
  )
}

/** The last runs of one routine; a run with a session opens its transcript in place. */
export function RunHistory({ bot, routineId, timezone, instruction, refreshKey }: RunHistoryProps) {
  const { runs, error } = useRuns(bot, routineId, refreshKey)
  const [openSession, setOpenSession] = useState<string | null>(null)

  if (openSession) {
    return (
      <div className="flex flex-col gap-2">
        <button type="button" onClick={() => setOpenSession(null)} className="self-start text-xs underline">Back to runs</button>
        <RunTranscript bot={bot} sessionId={openSession} instruction={instruction} />
      </div>
    )
  }
  if (runs === null) return <p className="text-xs text-muted-foreground">{error ? "Couldn't load the runs." : 'Loading…'}</p>
  if (runs.length === 0) return <p className="text-xs text-muted-foreground">No runs yet.</p>
  return (
    <ul className="flex flex-col gap-1">
      {runs.map(run => (
        <li key={run.id} className="rounded-md border border-border text-sm">
          {run.sessionId ? (
            <button type="button" onClick={() => setOpenSession(run.sessionId)} className="w-full p-2 text-left hover:bg-secondary">
              <span className="sr-only">{cleanTitle(run.title)}</span>
              <RunSummary run={run} timezone={timezone} />
            </button>
          ) : (
            <div className="p-2">
              <span className="block truncate text-xs">{cleanTitle(run.title)}</span>
              <RunSummary run={run} timezone={timezone} />
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
