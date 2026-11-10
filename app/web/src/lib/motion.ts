import type { Transition, Variants } from 'motion/react'

/**
 * Motion presets, copied from crew-bots (`lib/motion.ts`), which lifted them from the Watermelon components.
 * Use these instead of ad-hoc transitions (spec §5.3: springs only).
 */

/** State changes inside a control. Source: watermelon/inline-action. */
export const snappy: Transition = {
  type: 'spring',
  stiffness: 400,
  damping: 35,
  mass: 1
}

/** Sliding active pill in tabs and lists. Source: continuous-tabs. */
export const slide: Transition = {
  type: 'spring',
  stiffness: 380,
  damping: 30,
  mass: 0.9
}

/** Pill ↔ panel shared-layout morph. Source: create-new-disclosure. */
export const morph: Transition = { type: 'spring', bounce: 0.1, duration: 0.4 }

/** Height and layout shifts. Source: schedule-button (bounce: 0). */
export const settle: Transition = { type: 'spring', bounce: 0, duration: 0.45 }

/**
 * Opacity rides the spring, but blur uses a tween: a spring overshoots past
 * zero and a negative blur radius is an invalid filter.
 */
const blurSwapTransition: Transition = {
  ...snappy,
  filter: { type: 'tween', duration: 0.2, ease: 'easeOut' }
}

/** The Watermelon content swap: cross-fade through a 4px blur. */
export const blurSwap: Variants = {
  initial: { opacity: 0, filter: 'blur(4px)' },
  animate: {
    opacity: 1,
    filter: 'blur(0px)',
    transition: blurSwapTransition
  },
  exit: { opacity: 0, filter: 'blur(4px)', transition: blurSwapTransition }
}

/** List items arriving. Source: invite-disclosure, tightened for density. */
export const riseIn: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 6 }
}

/** Per-item delay for staggered lists. Source: invite-disclosure. */
export const STAGGER_STEP = 0.04

/** Press feedback shared by every pressable surface. */
export const press = { scale: 0.96 } as const
