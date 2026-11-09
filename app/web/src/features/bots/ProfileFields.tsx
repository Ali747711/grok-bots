import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

import { ModelSelect } from './ModelSelect'
import type { ProfileForm } from './profile-form'

interface ProfileFieldsProps {
  form: ProfileForm
  handle: string
  /** True when the bot has no pinned model, so "Default" is a valid choice. */
  allowDefault: boolean
  onChange: (patch: Partial<ProfileForm>) => void
}

const FIELD = 'flex flex-col gap-1.5'
const LABEL = 'text-sm font-medium'

/** Name, job, model and the advanced persona text. */
export function ProfileFields({ form, handle, allowDefault, onChange }: ProfileFieldsProps) {
  return (
    <>
      <div className={FIELD}>
        <label htmlFor="profile-name" className={LABEL}>Name</label>
        <Input id="profile-name" value={form.name} maxLength={80} onChange={e => onChange({ name: e.target.value })} />
        <span className="text-xs text-muted-foreground">{`@${handle}`}</span>
      </div>
      <div className={FIELD}>
        <label htmlFor="profile-job" className={LABEL}>Job</label>
        <Textarea id="profile-job" maxLength={2000} value={form.description} onChange={e => onChange({ description: e.target.value })} />
      </div>
      <div className={FIELD}>
        <label htmlFor="profile-model" className={LABEL}>Model</label>
        <ModelSelect id="profile-model" value={form.model} onChange={model => onChange({ model })} allowDefault={allowDefault} />
      </div>
      <details className="rounded-lg border border-border p-2">
        <summary className="cursor-pointer text-sm font-medium">Advanced</summary>
        <div className={`${FIELD} pt-2`}>
          <label htmlFor="profile-soul" className={LABEL}>Persona (SOUL.md)</label>
          <Textarea id="profile-soul" maxLength={100000} className="min-h-40 font-mono text-xs" value={form.soul} onChange={e => onChange({ soul: e.target.value })} />
        </div>
      </details>
    </>
  )
}
