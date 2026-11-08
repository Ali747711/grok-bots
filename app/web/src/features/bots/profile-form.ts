import type { BotDetail, BotLook, BotPatch, ModelChoice } from './types'

export interface ProfileForm {
  readonly name: string
  readonly description: string
  readonly soul: string
  /** null = the default model (nothing pinned). */
  readonly model: ModelChoice | null
  readonly look: BotLook
}

const DEFAULT_LOOK: BotLook = { shape: 'squircle', color: '#6366f1' }

export function lookOf(detail: BotDetail): BotLook {
  return {
    shape: detail.look.shape === 'circle' ? 'circle' : DEFAULT_LOOK.shape,
    color: detail.look.color ?? DEFAULT_LOOK.color
  }
}

export const fromDetail = (d: BotDetail): ProfileForm => ({
  name: d.title, description: d.description, soul: d.soul, model: d.model, look: lookOf(d)
})

const sameModel = (a: ModelChoice | null, b: ModelChoice | null) => a?.provider === b?.provider && a?.model === b?.model

/** Only what differs from `loaded`, plus `baseline` (taken from `baseline`) for each guarded field it contains. */
export function buildPatch(form: ProfileForm, loaded: BotDetail, baseline: BotDetail = loaded): BotPatch {
  const look = lookOf(loaded)
  const title = form.name.trim()
  const modelChanged = form.model !== null && !sameModel(form.model, loaded.model)
  const guarded = {
    ...(form.description !== loaded.description ? { description: baseline.description } : {}),
    ...(form.soul !== loaded.soul ? { soul: baseline.soul } : {}),
    ...(modelChanged ? { model: baseline.model } : {})
  }
  return {
    ...(title !== '' && title !== loaded.title ? { title } : {}),
    ...(form.look.shape !== look.shape || form.look.color !== look.color ? { look: form.look } : {}),
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
