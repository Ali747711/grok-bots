import { useId, type ReactNode } from 'react'
import { motion } from 'motion/react'

import { slide } from '@/lib/motion'
import { cn } from '@/lib/utils'

interface SectionProps {
  title: string
  hint?: string
  children: ReactNode
  className?: string
}

/** A titled group of settings: sentence-case title, optional hint, then the controls. */
export function Section({ title, hint, children, className }: SectionProps) {
  return (
    <section className={cn('flex flex-col gap-2.5', className)}>
      <div className="px-1">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {hint && <p className="mt-0.5 text-xs font-medium text-faint">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Accessible name, e.g. "Let Scout use its screen". */
  label: string
  disabled?: boolean
  describedBy?: string
}

/** On/off switch with a sprung knob. On is the one watermelon accent. */
export function Switch({ checked, onChange, label, disabled = false, describedBy }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-10 shrink-0 rounded-full outline-none transition-colors duration-300 focus-visible:ring-3 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-watermelon' : 'bg-switch-off'
      )}
    >
      <motion.span initial={false} animate={{ x: checked ? 16 : 0 }} transition={slide} className="absolute top-1 left-1 size-4 rounded-full bg-shell shadow-sm dark:bg-background" />
    </button>
  )
}

export interface Option<T extends string> {
  value: T
  label: string
  description?: string
}

interface ChoiceProps<T extends string> {
  /** Names the group for assistive tech. */
  legend: string
  value: T | null
  options: Option<T>[]
  onChange: (value: T) => void
  disabled?: boolean
}

/** Radio list with descriptions; the chosen row lifts to `shell`. */
export function OptionList<T extends string>({ legend, value, options, onChange, disabled = false }: ChoiceProps<T>) {
  const name = useId()
  return (
    <fieldset role="radiogroup" disabled={disabled} className="flex flex-col gap-0.5 disabled:opacity-60">
      <legend className="sr-only">{legend}</legend>
      {options.map(option => (
        <label
          key={option.value}
          className={cn(
            'group flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors has-checked:bg-shell has-focus-visible:ring-3 has-focus-visible:ring-ring',
            disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-shell'
          )}
        >
          <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} className="sr-only" />
          <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px] border-ring transition-colors group-has-checked:border-foreground">
            <span className="size-2 rounded-full bg-foreground opacity-0 transition-opacity group-has-checked:opacity-100" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold">{option.label}</span>
            {option.description && <span className="block text-xs font-medium text-faint">{option.description}</span>}
          </span>
        </label>
      ))}
    </fieldset>
  )
}

/** Single choice as a pill track with a sliding active pill, for short option sets. */
export function ChoiceChips<T extends string>({ legend, value, options, onChange, disabled = false }: ChoiceProps<T>) {
  const name = useId()
  return (
    <fieldset role="radiogroup" disabled={disabled} className="flex w-fit max-w-full flex-wrap items-center gap-0.5 rounded-full bg-shell p-1 disabled:opacity-60">
      <legend className="sr-only">{legend}</legend>
      {options.map(option => {
        const active = value === option.value
        return (
          <label key={option.value} className={cn('relative', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
            <input type="radio" name={name} value={option.value} checked={active} onChange={() => onChange(option.value)} className="peer sr-only" />
            {active && <motion.span layoutId={`${name}-pill`} transition={slide} className="absolute inset-0 rounded-full bg-raised" />}
            <span
              className={cn(
                'relative flex h-8 items-center rounded-full px-3 text-[13px] font-medium whitespace-nowrap transition-colors peer-focus-visible:ring-3 peer-focus-visible:ring-ring',
                active ? 'text-foreground' : 'text-muted-foreground',
                !active && !disabled && 'hover:text-foreground'
              )}
            >
              {option.label}
            </span>
          </label>
        )
      })}
    </fieldset>
  )
}
