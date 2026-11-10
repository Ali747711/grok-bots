import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, MotionConfig } from 'motion/react'
import { Check } from 'lucide-react'

import { CrewApiError } from '@/lib/crew-json'
import { blurSwap, snappy } from '@/lib/motion'
import { cn } from '@/lib/utils'

import { IndeterminateBar } from './motion-bits'

interface InlineActionProps {
  label: string
  icon: ReactNode
  /** The action button's accessible name. */
  actionText: string
  onAction: () => Promise<void>
  /** Turns a failure into the text shown to the user. Defaults to Crew's own message. */
  describeError?: (error: unknown) => string
  disabled?: boolean
  className?: string
}

type Phase = { kind: 'idle' } | { kind: 'loading' } | { kind: 'success' } | { kind: 'error'; message: string }

const SUCCESS_MS = 2000

/** Crew's refusal text when it sent one, else the error's own message. */
export function describeActionError(error: unknown): string {
  if (error instanceof CrewApiError) {
    const { message, error: code } = error.body ?? {}
    if (typeof message === 'string' && message) return message
    if (typeof code === 'string' && code) return code
    return error.message
  }
  return error instanceof Error && error.message ? error.message : 'Something went wrong'
}

const POD_WIDTH = { idle: 120, loading: 120, success: 48, error: 120 } as const

/** Runs the action and tracks its phase. A run that is already under way, or just succeeded, is not started again. */
function useActionPhase(onAction: () => Promise<void>, describeError: (error: unknown) => string) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  // A ref, not the phase: two activations in one tick both see the same rendered phase.
  const busy = useRef(false)

  useEffect(() => {
    if (phase.kind !== 'success') return
    const timer = setTimeout(() => {
      busy.current = false
      setPhase({ kind: 'idle' })
    }, SUCCESS_MS)
    return () => clearTimeout(timer)
  }, [phase.kind])

  const run = async () => {
    if (busy.current) return
    busy.current = true
    setPhase({ kind: 'loading' })
    try {
      await onAction()
      setPhase({ kind: 'success' })
    } catch (error) {
      busy.current = false
      setPhase({ kind: 'error', message: describeError(error) })
    }
  }

  return { phase, run }
}

const SWAP = { variants: blurSwap, initial: 'initial', animate: 'animate', exit: 'exit' } as const

interface ActionPodProps {
  phase: Phase
  actionText: string
  disabled: boolean
  onRun: () => void
}

/**
 * The button and what it shows. The button stays mounted through every phase so keyboard focus never
 * falls to the page; while busy it is `aria-disabled` (a natively disabled button cannot hold focus).
 */
function ActionPod({ phase, actionText, disabled, onRun }: ActionPodProps) {
  const busy = phase.kind === 'loading' || phase.kind === 'success'
  const text = phase.kind === 'error' ? 'Try again' : actionText
  return (
    <MotionConfig transition={snappy}>
      <motion.div className="relative flex h-10 items-center overflow-hidden rounded-full bg-control px-2" animate={{ width: POD_WIDTH[phase.kind] }}>
        <button
          type="button"
          aria-label={text}
          aria-busy={phase.kind === 'loading' || undefined}
          aria-disabled={busy || undefined}
          disabled={disabled}
          onClick={onRun}
          className="relative flex h-full w-full items-center justify-center rounded-full text-[13px] font-semibold whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-default"
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {!busy && <motion.span key="action" {...SWAP}>{text}</motion.span>}
            {phase.kind === 'loading' && (
              <motion.span key="loading" {...SWAP} className="block w-full">
                <IndeterminateBar label={`${actionText} in progress`} />
              </motion.span>
            )}
            {phase.kind === 'success' && (
              <motion.span key="success" {...SWAP} className="flex h-full w-full items-center justify-center rounded-full bg-foreground text-background">
                <Check className="size-5" aria-hidden="true" />
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </motion.div>
    </MotionConfig>
  )
}

/**
 * A pill row with one action: idle, then a progress bar, then a check that returns to idle after 2 s.
 * A failure never resets on its own: the reason stays in view with a Try again button.
 */
export function InlineAction({ label, icon, actionText, onAction, describeError = describeActionError, disabled = false, className }: InlineActionProps) {
  const { phase, run } = useActionPhase(onAction, describeError)
  return (
    <div className={cn('flex w-full flex-col gap-2', className)}>
      <div className="flex items-center justify-between gap-3 overflow-hidden rounded-full bg-raised p-2 pr-2">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-control text-foreground">{icon}</span>
          <span className="truncate text-[15px] font-semibold">{label}</span>
        </div>
        <ActionPod phase={phase} actionText={actionText} disabled={disabled} onRun={run} />
        <span role="status" className="sr-only">{phase.kind === 'success' ? 'Done' : ''}</span>
      </div>
      {phase.kind === 'error' && (
        <p role="alert" className="px-4 text-[13px] font-medium text-destructive">
          {phase.message}
        </p>
      )}
    </div>
  )
}
