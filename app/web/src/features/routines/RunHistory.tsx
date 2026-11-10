import { Zap } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { durationText, RUN_TONE, STATUS_WORD } from './run-format'
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
  return (
    <>
      {run.trigger && (
        <span className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
          <Zap aria-hidden className="size-3" />
          {`${run.trigger.name} · ${run.trigger.eventType}`}
        </span>
      )}
      <span className="flex items-center gap-2">
        <Badge className={cn('h-5 px-2 text-xs', RUN_TONE[run.status])}>{STATUS_WORD[run.status]}</Badge>
        <span className="text-xs text-muted-foreground">{formatInZone(run.startedAt, timezone)}</span>
        <span className="ml-auto text-xs text-muted-foreground">{durationText(run)}</span>
      </span>
      {run.error && <span className="mt-1 block text-xs text-destructive">{run.error}</span>}
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
        <Button type="button" size="xs" variant="ghost" onClick={() => setOpenSession(null)} className="self-start">Back to runs</Button>
        <RunTranscript bot={bot} sessionId={openSession} instruction={instruction} />
      </div>
    )
  }
  if (runs === null) return <p className="text-xs text-muted-foreground">{error ? "Couldn't load the runs." : 'Loading…'}</p>
  if (runs.length === 0) return <p className="text-xs text-muted-foreground">No runs yet.</p>
  return (
    <ul className="flex flex-col gap-1">
      {runs.map(run => (
        <li key={run.id} className="rounded-xl bg-card text-sm">
          {run.sessionId ? (
            <button type="button" onClick={() => setOpenSession(run.sessionId)} className="w-full rounded-xl p-2.5 text-left hover:bg-muted">
              <span className="sr-only">{cleanTitle(run.title)}</span>
              <RunSummary run={run} timezone={timezone} />
            </button>
          ) : (
            <div className="p-2.5">
              <span className="block truncate text-xs">{cleanTitle(run.title)}</span>
              <RunSummary run={run} timezone={timezone} />
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
