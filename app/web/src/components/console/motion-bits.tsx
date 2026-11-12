import type { ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

import { blurSwap, snappy } from '@/lib/motion'
import { cn } from '@/lib/utils'

interface BlurSwapProps {
  /** Changing this key triggers the swap. */
  id: string
  children: ReactNode
  className?: string
}

/**
 * Watermelon's content swap: the old value blurs out as the new one blurs in. The parent must be
 * `relative` so the leaving value can pop out of flow. Both values exist for a moment, so the animated
 * pair is hidden from assistive tech and one stable copy is exposed instead.
 */
export function BlurSwap({ id, children, className }: BlurSwapProps) {
  return (
    <>
      <span className="sr-only">{children}</span>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={id}
          aria-hidden="true"
          variants={blurSwap}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={snappy}
          className={cn('inline-block max-w-full truncate align-bottom', className)}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </>
  )
}

interface IndeterminateBarProps {
  label?: string
  className?: string
}

/**
 * Looping progress track. The loop is a tween because a spring never repeats. It animates `left`, which
 * `MotionConfig reducedMotion` does not stop, so under reduced motion the fill is drawn still instead.
 */
export function IndeterminateBar({ label = 'In progress', className }: IndeterminateBarProps) {
  const still = useReducedMotion()
  return (
    <span role="progressbar" aria-label={label} className={cn('relative block h-1.5 shrink-0 overflow-hidden rounded-full bg-control', className)}>
      {still ? (
        <span data-motion="static" className="absolute inset-y-0 left-[35%] w-[30%] rounded-full bg-foreground/80" />
      ) : (
        <motion.span
          data-motion="loop"
          className="absolute inset-y-0 w-[30%] rounded-full bg-foreground/80"
          initial={{ left: '0%' }}
          animate={{ left: '70%' }}
          transition={{ duration: 0.8, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut' }}
        />
      )}
    </span>
  )
}
