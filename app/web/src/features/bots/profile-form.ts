import type { BotDetail, BotPatch, ModelChoice } from './types'

/** The form's look: the shape may be one Crew does not offer (kept as Hermes has it until the user picks another). */
export interface FormLook {
  readonly shape: string
  readonly color: string
}

export interface ProfileForm {
  readonly name: string
  readonly description: string
  readonly soul: string
  /** null = the default model (nothing pinned). */
  readonly model: ModelChoice | null
  readonly look: FormLook
}

/** What the user edits (`form`) next to the values it started from (`loaded`); a field is dirty when they differ. */
export interface FormSync {
  readonly form: ProfileForm
  readonly loaded: ProfileForm
}

const DEFAULT_LOOK: FormLook = { shape: 'squircle', color: '#6366f1' }

export function lookOf(detail: BotDetail): FormLook {
  return {
    shape: detail.look.shape || DEFAULT_LOOK.shape,
    color: detail.look.color ?? DEFAULT_LOOK.color
  }
}

export const fromDetail = (d: BotDetail): ProfileForm => ({
  name: d.title, description: d.description, soul: d.soul, model: d.model, look: lookOf(d)
})

export const freshSync = (d: BotDetail): FormSync => ({ form: fromDetail(d), loaded: fromDetail(d) })

const sameModel = (a: ModelChoice | null, b: ModelChoice | null) => a?.provider === b?.provider && a?.model === b?.model
const sameLook = (a: FormLook, b: FormLook) => a.shape === b.shape && a.color === b.color

type Field = keyof ProfileForm
const same: { [K in Field]: (a: ProfileForm[K], b: ProfileForm[K]) => boolean } = {
  name: (a, b) => a === b,
  description: (a, b) => a === b,
  soul: (a, b) => a === b,
  model: sameModel,
  look: sameLook
}
const FIELDS = Object.keys(same) as Field[]

function mergeField<K extends Field>(key: K, sync: FormSync, fresh: ProfileForm): [ProfileForm[K], ProfileForm[K]] {
  const eq = same[key]
  const untouched = eq(sync.form[key], sync.loaded[key])
  // A field the user edited keeps its start value, unless Hermes now holds what they typed (our own partial write).
  if (untouched || eq(sync.form[key], fresh[key])) return [fresh[key], fresh[key]]
  return [sync.form[key], sync.loaded[key]]
}

/** Take a freshly read bot into the form without touching edits: a real change elsewhere to an edited field stays a conflict. */
export function mergeFresh(sync: FormSync, detail: BotDetail): FormSync {
  const fresh = fromDetail(detail)
  let form = sync.form
  let loaded = sync.loaded
  for (const key of FIELDS) {
    const [f, l] = mergeField(key, sync, fresh)
    form = { ...form, [key]: f }
    loaded = { ...loaded, [key]: l }
  }
  return { form, loaded }
}

/** Only the look keys that changed: an untouched shape or colour is never sent (it may not be Crew's to overwrite). */
function lookPatch(look: FormLook, loaded: FormLook): Pick<BotPatch, 'look'> {
  const shape = look.shape !== loaded.shape ? { shape: look.shape } : {}
  const color = look.color !== loaded.color ? { color: look.color } : {}
  return Object.keys({ ...shape, ...color }).length > 0 ? { look: { ...shape, ...color } } : {}
}

/** Only what differs from `loaded`, plus `baseline` (from `loaded`) for each guarded field it contains. */
export function buildPatch(form: ProfileForm, loaded: ProfileForm): BotPatch {
  const title = form.name.trim()
  const modelChanged = form.model !== null && !sameModel(form.model, loaded.model)
  const guarded = {
    ...(form.description !== loaded.description ? { description: loaded.description } : {}),
    ...(form.soul !== loaded.soul ? { soul: loaded.soul } : {}),
    ...(modelChanged ? { model: loaded.model } : {})
  }
  return {
    ...(title !== '' && title !== loaded.name ? { title } : {}),
    ...lookPatch(form.look, loaded.look),
    ...(form.description !== loaded.description ? { description: form.description } : {}),
    ...(form.soul !== loaded.soul ? { soul: form.soul } : {}),
    ...(modelChanged && form.model ? { model: form.model } : {}),
    ...(Object.keys(guarded).length > 0 ? { baseline: guarded } : {})
  }
}

export const hasChanges = (patch: BotPatch): boolean => Object.keys(patch).length > 0

/** The same patch judged against another version of the bot (a 409's `current`). */
export function rebase(patch: BotPatch, current: BotDetail): BotPatch {
  if (!patch.baseline) return patch
  const baseline = {
    ...(patch.description !== undefined ? { description: current.description } : {}),
    ...(patch.soul !== undefined ? { soul: current.soul } : {}),
    ...(patch.model !== undefined ? { model: current.model } : {})
  }
  return { ...patch, baseline }
}
