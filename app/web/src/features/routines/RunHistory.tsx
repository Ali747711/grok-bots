import { Zap } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'

import { GHOST } from './row-styles'
import { durationText, RUN_TONE, STATUS_WORD } from './run-format'
import { RunTranscript } from './RunTranscript'
import { StatusPill } from './StatusPill'
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

const NOTE = 'px-1 text-xs font-medium text-muted-foreground'

/** Run titles carry Hermes's `[bot:<name>]` tag; it is internal. */
const cleanTitle = (title: string) => title.replace(/^\[bot:[a-z0-9][a-z0-9_-]*\]\s*/, '')

function RunSummary({ run, timezone }: { run: RunView; timezone: string | null }) {
  return (
    <>
      {run.trigger && (
        <span className="mb-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <Zap aria-hidden className="size-3" />
          {`${run.trigger.name} · ${run.trigger.eventType}`}
        </span>
      )}
      <span className="flex items-center gap-2">
        <StatusPill tone={RUN_TONE[run.status]}>{STATUS_WORD[run.status]}</StatusPill>
        <span className="text-xs font-medium text-muted-foreground">{formatInZone(run.startedAt, timezone)}</span>
        <span className="ml-auto text-xs font-medium text-muted-foreground tabular-nums">{durationText(run)}</span>
      </span>
      {run.error && <span className="mt-1.5 block text-xs font-medium text-destructive">{run.error}</span>}
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
        <Button type="button" size="xs" variant="ghost" onClick={() => setOpenSession(null)} className={`self-start ${GHOST}`}>Back to runs</Button>
        <RunTranscript bot={bot} sessionId={openSession} instruction={instruction} />
      </div>
    )
  }
  if (runs === null) return <p className={NOTE}>{error ? "Couldn't load the runs." : 'Loading…'}</p>
  if (runs.length === 0) return <p className={NOTE}>No runs yet.</p>
  return (
    <ul className="flex flex-col gap-1">
      {runs.map(run => (
        <li key={run.id} className="rounded-xl bg-shell text-sm">
          {run.sessionId ? (
            <button type="button" onClick={() => setOpenSession(run.sessionId)} className="w-full rounded-xl p-2.5 text-left outline-none transition-colors hover:bg-raised focus-visible:ring-3 focus-visible:ring-ring">
              <span className="sr-only">{cleanTitle(run.title)}</span>
              <RunSummary run={run} timezone={timezone} />
            </button>
          ) : (
            <div className="p-2.5">
              <span className="mb-1.5 block truncate text-xs font-medium">{cleanTitle(run.title)}</span>
              <RunSummary run={run} timezone={timezone} />
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
