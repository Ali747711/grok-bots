import type { ReactNode } from 'react'

import { RolePicker } from '@/components/console/role-picker'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ModelSelect } from '@/features/bots/ModelSelect'
import type { ProfileForm } from '@/features/bots/profile-form'

export interface TextTabProps {
  form: ProfileForm
  title: string
  onChange: (change: Partial<ProfileForm>) => void
}

interface IdentityTabProps extends TextTabProps {
  handle: string
  /** True when the bot has no pinned model, so "Default" is a valid choice. */
  allowDefault: boolean
}

/** A field on the profile's `bg-background` well takes the shell fill in light (light review I3); dark keeps its own. */
export const ON_WELL = 'not-dark:bg-shell'
export const NAME_MAX = 80
export const JOB_MAX = 2000

interface FieldProps {
  /** The label, as a real `<label>` for a field or a caption for a group that names itself. */
  label: ReactNode
  hint?: string
  children: ReactNode
}

/** One labelled setting: the label in the row-label style, an optional hint, then the control. */
export function Field({ label, hint, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="px-1">
        <div className="text-[13px] font-semibold">{label}</div>
        {hint && <p className="mt-0.5 text-xs font-medium text-faint">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

/** Who the bot is: name, role, job and model. All four wait for the save bar. */
export function IdentityTab({ form, title, handle, allowDefault, onChange }: IdentityTabProps) {
  return (
    <>
      <Field label={<label htmlFor="profile-name">Name</label>} hint="Shown in the rail and in the conversation.">
        <Input id="profile-name" className={ON_WELL} value={form.name} maxLength={NAME_MAX} autoComplete="off" onChange={e => onChange({ name: e.target.value })} />
        <p className="px-1 text-xs font-medium text-muted-foreground">
          <span>{`@${handle}`}</span>
          <span className="text-faint"> · the handle never changes</span>
        </p>
      </Field>
      <Field label="Role" hint={`Optional. Shown beside ${title}'s model.`}>
        <RolePicker value={form.role} onChange={role => onChange({ role })} />
      </Field>
      <Field label={<label htmlFor="profile-job">Job</label>} hint={`What ${title} is for.`}>
        <Textarea id="profile-job" className={ON_WELL} maxLength={JOB_MAX} value={form.description} onChange={e => onChange({ description: e.target.value })} />
      </Field>
      <Field label={<span id="profile-model-label">Model</span>} hint="The model that does the thinking. Hermes asks before a costly one.">
        <ModelSelect id="profile-model" className={ON_WELL} value={form.model} onChange={model => onChange({ model })} allowDefault={allowDefault} />
      </Field>
    </>
  )
}
