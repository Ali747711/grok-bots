import { Check, ChevronDown, Square, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useId, useState } from 'react'

import type { ChatItem, WorkStep } from '@/chat/types'
import { BlurSwap, IndeterminateBar } from '@/components/console/motion-bits'
import { StatusDot } from '@/components/console/status'
import { settle } from '@/lib/motion'
import { cn } from '@/lib/utils'

type Work = Extract<ChatItem, { kind: 'work' }>
type StepState = 'done' | 'running' | 'failed'

const DETAIL_MAX = 4000
const FOCUS = 'outline-none focus-visible:ring-3 focus-visible:ring-ring'

const stepState = (step: WorkStep): StepState => (step.running ? 'running' : step.isError ? 'failed' : 'done')

/** The card's one-line summary, in Crew's copy (R10). */
export function runLabel(item: Work): string {
  const count = item.steps.length
  const steps = `${count} ${count === 1 ? 'step' : 'steps'}`
  if (item.steps.some(s => s.running)) return `Working · ${steps}`
  if (item.interrupted) return `Stopped after ${steps}`
  return item.durationS === undefined ? `Worked · ${steps}` : `Worked for ${Math.round(item.durationS)}s · ${steps}`
}

function StepDetail({ detail }: { detail: string }) {
  const [all, setAll] = useState(false)
  const long = detail.length > DETAIL_MAX
  return (
    <div className="mt-1.5 ml-[26px]">
      <pre data-testid="step-detail" className="max-h-72 scroll-thin overflow-auto rounded-xl bg-raised p-2.5 font-mono text-xs whitespace-pre-wrap">
        {all || !long ? detail : detail.slice(0, DETAIL_MAX)}
      </pre>
      {long && !all && (
        <button type="button" onClick={() => setAll(true)} className={cn('mt-1 rounded-sm text-xs font-medium text-muted-foreground underline underline-offset-2', FOCUS)}>
          Show more
        </button>
      )}
    </div>
  )
}

const MARKER: Record<StepState, string> = {
  done: 'bg-faint text-background',
  running: 'border-[1.5px] border-foreground bg-shell',
  failed: 'border-[1.5px] border-destructive bg-shell text-destructive'
}

function StepMarker({ state }: { state: StepState }) {
  return (
    <span aria-hidden="true" className={cn('relative mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full', MARKER[state])}>
      {state === 'done' && <Check className="size-2.5" strokeWidth={3.5} />}
      {state === 'running' && <span className="size-1.5 rounded-full bg-foreground motion-safe:animate-pulse" />}
      {state === 'failed' && <X className="size-2.5" strokeWidth={3.5} />}
    </span>
  )
}

/** A failed step reads as a neutral pill with an error dot (PF31): never destructive text on a tinted fill. */
function FailedBadge() {
  return (
    <span className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full bg-raised px-2 text-[11px] font-medium text-foreground">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-status-error" />
      Failed
    </span>
  )
}

function StepLine({ step, state }: { step: WorkStep; state: StepState }) {
  return (
    <span className="flex min-w-0 flex-1 items-start gap-2.5 text-left">
      <StepMarker state={state} />
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-semibold text-foreground">{step.name}</span>
        <span className="min-w-0 break-all text-muted-foreground">{step.summary}</span>
        {state === 'failed' && <FailedBadge />}
      </span>
    </span>
  )
}

/** One tool call on the connector line. A step that has output is a button that shows it. */
function Step({ step }: { step: WorkStep }) {
  const [open, setOpen] = useState(false)
  const detailId = useId()
  const state = stepState(step)
  return (
    <li data-state={state} aria-current={state === 'running' ? 'step' : undefined} className="relative text-[13px] font-medium">
      {step.detail ? (
        <button type="button" aria-expanded={open} aria-controls={detailId} onClick={() => setOpen(v => !v)} className={cn('flex w-full rounded-lg', FOCUS)}>
          <StepLine step={step} state={state} />
          <ChevronDown aria-hidden="true" className={cn('mt-0.5 size-3.5 shrink-0 text-faint transition-transform', open && 'rotate-180')} />
        </button>
      ) : (
        <div className="flex w-full">
          <StepLine step={step} state={state} />
        </div>
      )}
      {step.detail && <div id={detailId}>{open && <StepDetail detail={step.detail} />}</div>}
    </li>
  )
}

function RunGlyph({ item, running }: { item: Work; running: boolean }) {
  if (running) return <StatusDot status="working" />
  if (item.interrupted) return <Square className="size-3" fill="currentColor" />
  return <Check className="size-4" strokeWidth={2.5} />
}

/**
 * A turn's tool calls. Collapsed it is a pill: the running step and "Working · n steps" while the bot works,
 * then "Worked for …" or "Stopped after …". Open it lists every step on a connector line.
 * Renders nothing while the turn has no step. Adapted from crew-bots' run card.
 */
export function RunCard({ item }: { item: Work }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  if (item.steps.length === 0) return null
  const current = item.steps.findLast(s => s.running)
  const label = runLabel(item)
  return (
    <div className="overflow-hidden rounded-[22px] border border-border">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(v => !v)}
        className={cn('flex h-11 w-full items-center gap-2.5 rounded-[22px] pr-3 pl-1.5 text-left transition-colors hover:bg-hover focus-visible:ring-inset', FOCUS)}
      >
        <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-raised text-muted-foreground">
          <RunGlyph item={item} running={current !== undefined} />
        </span>
        {current ? (
          <>
            <span className="relative min-w-0 flex-1 text-[13px] font-semibold">
              <BlurSwap id={`${current.id}:${current.summary}`}>{current.summary}</BlurSwap>
            </span>
            <IndeterminateBar className="w-10" label="Working" />
            <span className="shrink-0 text-xs font-medium text-faint tabular-nums">{label}</span>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold tabular-nums">{label}</span>
        )}
        <ChevronDown aria-hidden="true" className={cn('size-4 shrink-0 text-faint transition-transform', open && 'rotate-180')} />
      </button>
      <div id={panelId}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} transition={settle} className="overflow-hidden">
            <ol className="relative m-0 flex list-none flex-col gap-2.5 pt-1 pr-4 pb-3.5 pl-[18px]">
              <span aria-hidden="true" className="absolute top-3 bottom-5 left-[25.5px] w-px bg-border" />
              {item.steps.map(step => <Step key={step.id} step={step} />)}
            </ol>
          </motion.div>
        )}
      </div>
    </div>
  )
}
