import type { BotDetail, BotPatch, ModelChoice } from './types'

export interface ProfileForm {
  readonly name: string
  readonly description: string
  readonly soul: string
  /** null = the default model (nothing pinned). */
  readonly model: ModelChoice | null
}

/** What the user edits (`form`) next to the values it started from (`loaded`); a field is dirty when they differ. */
export interface FormSync {
  readonly form: ProfileForm
  readonly loaded: ProfileForm
}

export const fromDetail = (d: BotDetail): ProfileForm => ({
  name: d.title, description: d.description, soul: d.soul, model: d.model
})

export const freshSync = (d: BotDetail): FormSync => ({ form: fromDetail(d), loaded: fromDetail(d) })

const sameModel = (a: ModelChoice | null, b: ModelChoice | null) => a?.provider === b?.provider && a?.model === b?.model

type Field = keyof ProfileForm
const same: { [K in Field]: (a: ProfileForm[K], b: ProfileForm[K]) => boolean } = {
  name: (a, b) => a === b,
  description: (a, b) => a === b,
  soul: (a, b) => a === b,
  model: sameModel
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
