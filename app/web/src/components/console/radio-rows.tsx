import { useId, type ReactNode } from 'react'

import { FIELD_LABEL } from './dialog-styles'

interface RadioRow<T extends string> {
  readonly value: T
  readonly label: string
  /** A line under the label. */
  readonly hint?: string
}

interface RadioRowsProps<T extends string> {
  /** Shown above the rows; names both the group and the radio group. */
  legend: string
  /** False where a heading above already shows the legend: it then only names the radio group. */
  showLegend?: boolean
  value: T
  options: readonly RadioRow<T>[]
  onChange: (value: T) => void
  /** A hint under the rows, inside the group. */
  children?: ReactNode
}

/**
 * A short single choice in the console option-list look: rows in a well, the chosen row lifted to the shell.
 * Unlike `OptionList`, the real radio covers its whole row instead of hiding off-screen, so a click or
 * `.check()` on the radio itself lands on it (the e2e specs do that), and the legend is visible.
 */
export function RadioRows<T extends string>({ legend, showLegend = true, value, options, onChange, children }: RadioRowsProps<T>) {
  const name = useId()
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      {showLegend && <legend className={`${FIELD_LABEL} mb-2`}>{legend}</legend>}
      <div role="radiogroup" aria-label={legend} className="flex flex-col gap-0.5 rounded-[20px] bg-background p-1">
        {options.map(option => (
          <label key={option.value} className="group relative flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-shell has-checked:bg-shell has-focus-visible:ring-3 has-focus-visible:ring-ring">
            <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} className="absolute inset-0 m-0 size-full cursor-pointer opacity-0" />
            <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px] border-ring transition-colors group-has-checked:border-foreground">
              <span className="size-2 rounded-full bg-foreground opacity-0 transition-opacity group-has-checked:opacity-100" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold">{option.label}</span>
              {option.hint && <span className="block text-xs font-medium text-faint">{option.hint}</span>}
            </span>
          </label>
        ))}
      </div>
      {children}
    </fieldset>
  )
}
