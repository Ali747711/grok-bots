import { useEffect, useState, type ReactNode } from 'react'
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

/**
 * A pill row with one action: idle, then a progress bar, then a check that returns to idle after 2 s.
 * A failure never resets on its own: the reason stays in view with a Try again button.
 */
export function InlineAction({ label, icon, actionText, onAction, describeError = describeActionError, disabled = false, className }: InlineActionProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

  useEffect(() => {
    if (phase.kind !== 'success') return
    const timer = setTimeout(() => setPhase({ kind: 'idle' }), SUCCESS_MS)
    return () => clearTimeout(timer)
  }, [phase.kind])

  const run = async () => {
    if (phase.kind === 'loading' || phase.kind === 'success') return
    setPhase({ kind: 'loading' })
    try {
      await onAction()
      setPhase({ kind: 'success' })
    } catch (error) {
      setPhase({ kind: 'error', message: describeError(error) })
    }
  }

  const buttonText = phase.kind === 'error' ? 'Try again' : actionText

  return (
    <div className={cn('flex w-full flex-col gap-2', className)}>
      <div className="flex items-center justify-between gap-3 overflow-hidden rounded-full bg-raised p-2 pr-2">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-control text-foreground">{icon}</span>
          <span className="truncate text-[15px] font-semibold">{label}</span>
        </div>
        <MotionConfig transition={snappy}>
          <motion.div className="relative flex h-10 items-center overflow-hidden rounded-full bg-control px-2" animate={{ width: POD_WIDTH[phase.kind] }}>
            <AnimatePresence mode="popLayout" initial={false}>
              {(phase.kind === 'idle' || phase.kind === 'error') && (
                <motion.button
                  key="action"
                  type="button"
                  variants={blurSwap}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  disabled={disabled}
                  onClick={run}
                  className="h-full w-full rounded-full text-[13px] font-semibold whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {buttonText}
                </motion.button>
              )}
              {phase.kind === 'loading' && (
                <motion.div key="loading" variants={blurSwap} initial="initial" animate="animate" exit="exit" className="w-full">
                  <IndeterminateBar label={`${actionText} in progress`} />
                </motion.div>
              )}
              {phase.kind === 'success' && (
                <motion.div
                  key="success"
                  variants={blurSwap}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="flex h-full w-full items-center justify-center rounded-full bg-foreground text-background"
                >
                  <Check className="size-5" aria-hidden="true" />
                  <span className="sr-only">Done</span>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </MotionConfig>
      </div>
      {phase.kind === 'error' && (
        <p role="alert" className="px-4 text-[13px] font-medium text-destructive">
          {phase.message}
        </p>
      )}
    </div>
  )
}
