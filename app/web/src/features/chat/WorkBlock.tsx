import { useState } from 'react'

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { ChatItem, WorkStep } from '@/chat/types'

type Work = Extract<ChatItem, { kind: 'work' }>

const DETAIL_MAX = 4000

function StepDetail({ detail }: { detail: string }) {
  const [all, setAll] = useState(false)
  const long = detail.length > DETAIL_MAX
  return (
    <div className="mt-1">
      <pre data-testid="step-detail" className="max-h-72 overflow-auto rounded-lg bg-card p-2 font-mono text-xs whitespace-pre-wrap">
        {all || !long ? detail : detail.slice(0, DETAIL_MAX)}
      </pre>
      {long && !all && (
        <button type="button" onClick={() => setAll(true)} className="mt-1 text-xs text-muted-foreground underline">
          Show more
        </button>
      )}
    </div>
  )
}

function Step({ step }: { step: WorkStep }) {
  return (
    <li className="py-1">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium">{step.name}</span>
        <span className="min-w-0 break-all text-muted-foreground">{step.summary}</span>
        {step.isError && <span className="text-xs font-medium text-destructive">Failed</span>}
      </div>
      {step.detail && <StepDetail detail={step.detail} />}
    </li>
  )
}

function label(item: Work): string {
  const count = item.steps.length
  const noun = `${count} ${count === 1 ? 'step' : 'steps'}`
  const verb = item.steps.some(s => s.running) ? 'Working' : 'Worked'
  const time = item.durationS !== undefined && verb === 'Worked' ? ` for ${Math.round(item.durationS)}s` : ''
  return `${verb}${time} · ${noun}`
}

/** A turn's tool calls, collapsed to one line. Renders nothing while the block has no steps. */
export function WorkBlock({ item }: { item: Work }) {
  const [open, setOpen] = useState(false)
  if (item.steps.length === 0) return null
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-2 rounded-xl bg-muted">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-muted-foreground">
        <span aria-hidden>{open ? '▾' : '▸'}</span>
        {label(item)}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="m-0 list-none px-3 pb-2.5 text-[13px]">{item.steps.map(s => <Step key={s.id} step={s} />)}</ul>
      </CollapsibleContent>
    </Collapsible>
  )
}
