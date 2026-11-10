import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

import { Field, type TextTabProps } from './IdentityTab'

export const SOUL_MAX = 100_000

interface Starter {
  label: string
  write: (title: string) => string
}

// crew-bots' starting points (R12). A click adds one to the persona; it never replaces what is there.
const STARTERS: readonly Starter[] = [
  { label: 'Careful', write: title => `You are ${title}. Check your work before you report it, say plainly when you are unsure, and ask before any step that cannot be undone.` },
  { label: 'Fast', write: title => `You are ${title}. Move quickly, pick sensible defaults without asking, and keep updates to one line.` },
  { label: 'Friendly', write: title => `You are ${title}. Be warm and plain-spoken, explain what you are doing as you go, and never hide a mistake.` }
]

/** The persona with `text` added after a blank line; an empty persona becomes `text`. */
export function appendStarter(soul: string, text: string): string {
  const kept = soul.trimEnd()
  return kept === '' ? text : `${kept}\n\n${text}`
}

/** The persona (SOUL.md), with starters that only ever add text. It waits for the save bar. */
export function SoulTab({ form, title, onChange }: TextTabProps) {
  return (
    <Field
      label={<label htmlFor="profile-soul">Persona (SOUL.md)</label>}
      hint={`Who ${title} is: its voice, its values and the lines it will not cross. Plain language works best.`}
    >
      <Textarea
        id="profile-soul"
        maxLength={SOUL_MAX}
        className="max-h-[50vh] min-h-48 overflow-y-auto font-mono text-xs leading-relaxed md:text-xs"
        value={form.soul}
        onChange={e => onChange({ soul: e.target.value })}
      />
      <div className="flex flex-wrap items-center gap-1.5 px-1">
        <span className="text-xs font-medium text-faint">Add a starter</span>
        {STARTERS.map(starter => {
          const next = appendStarter(form.soul, starter.write(title))
          return <Button key={starter.label} type="button" variant="secondary" size="sm" disabled={next.length > SOUL_MAX} onClick={() => onChange({ soul: next })}>{starter.label}</Button>
        })}
        <span className="ml-auto text-xs font-medium text-faint tabular-nums">{`${form.soul.length.toLocaleString('en-US')} / ${SOUL_MAX.toLocaleString('en-US')}`}</span>
      </div>
    </Field>
  )
}
