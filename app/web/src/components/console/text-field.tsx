import type { InputHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'placeholder' | 'id'> {
  label: string
  id: string
}

/**
 * Bordered text field whose label rises onto the border when the field is focused or filled. The rise
 * is pure CSS, so pre-filled and controlled values work. It must sit on a `bg-background` well, because
 * the raised label notches the border with that colour.
 */
export function TextField({ label, id, className, ...props }: TextFieldProps) {
  return (
    <div className="relative text-[13px] font-medium">
      <input
        id={id}
        placeholder=" "
        className={cn('peer h-11 w-full rounded-2xl border border-border bg-transparent px-3.5 outline-none transition-colors focus:border-ring', className)}
        {...props}
      />
      <label
        htmlFor={id}
        className={cn(
          'pointer-events-none absolute top-3 left-3.5 text-muted-foreground transition-all duration-200',
          'peer-focus:-top-2 peer-focus:left-2.5 peer-focus:bg-background peer-focus:px-1 peer-focus:text-[11px] peer-focus:text-foreground',
          'peer-[:not(:placeholder-shown)]:-top-2 peer-[:not(:placeholder-shown)]:left-2.5 peer-[:not(:placeholder-shown)]:bg-background peer-[:not(:placeholder-shown)]:px-1 peer-[:not(:placeholder-shown)]:text-[11px]'
        )}
      >
        {label}
      </label>
    </div>
  )
}
