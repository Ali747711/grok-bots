import { useLayoutEffect, useRef, useState } from 'react'

import { RolePicker } from '@/components/console/role-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { deriveAvatarType, type AvatarType } from '@/features/avatars/avatar-model'
import { AvatarPicker, type AvatarValue } from '@/features/avatars/AvatarPicker'

import { createBot, finishBot, updateBot } from './bots-api'
import { describeCreateFailure } from './create-errors'
import { ModelSelect } from './ModelSelect'
import type { BotRole } from './roles'
import { SandboxChoice } from './SandboxChoice'
import { NAME_MESSAGES, slugifyProfileName, validateBotName } from './slug'
import type { CreateResult, ModelChoice } from './types'

/** What the New bot panel holds between openings. */
export interface NewBotDraft {
  readonly name: string
  /** Follows the name until `handleEdited`. */
  readonly handle: string
  readonly handleEdited: boolean
  readonly mission: string
  /** A null type follows the handle until the user picks one. */
  readonly avatar: { readonly type: AvatarType | null; readonly color?: string }
  /** 256 px PNG data url of an uploaded photo. */
  readonly image?: string
  readonly model: ModelChoice | null
  readonly sandbox: boolean
  readonly role: BotRole | null
}

export const EMPTY_NEW_BOT_DRAFT: NewBotDraft = { name: '', handle: '', handleEdited: false, mission: '', avatar: { type: null }, model: null, sandbox: false, role: null }

interface NewBotFormProps {
  draft: NewBotDraft
  onDraft: (draft: NewBotDraft) => void
  /** The bot exists (complete, or the user chose to open a half-made one). */
  onCreated: (name: string) => void
  /** A bot was made from this draft but is not finished: the draft must not make a second one. */
  onPartial?: () => void
  /** True while a create or finish call is in flight, so the panel can stay open until it answers. */
  onBusyChange?: (busy: boolean) => void
}

const FIELD = 'flex flex-col gap-1.5'
const LABEL = 'text-[13px] font-semibold'
/** Create stays in view on a short window (light review I8): it sticks to the bottom of the panel's scrolling body, which has no bottom padding of its own. */
const FOOTER = 'sticky bottom-0 z-10 -mx-3 flex flex-col gap-2 bg-shell px-3 pt-2 pb-3'

interface Failure {
  handle?: string
  general?: string
}

/** Busy flag, failure text and the partial result for create / finish calls. */
function useCreateFlow({ onCreated, onPartial, onBusyChange }: Pick<NewBotFormProps, 'onCreated' | 'onPartial' | 'onBusyChange'>) {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Failure>({})
  const [partial, setPartial] = useState<CreateResult | null>(null)

  const run = async (action: () => Promise<CreateResult>) => {
    setBusy(true)
    onBusyChange?.(true)
    setFailure({})
    try {
      const result = await action()
      if (result.complete && !result.needsModel) {
        onCreated(result.name)
      } else {
        setPartial(result)
        onPartial?.()
      }
    } catch (error) {
      setFailure(describeCreateFailure(error))
    } finally {
      setBusy(false)
      onBusyChange?.(false)
    }
  }
  return { busy, failure, setFailure, partial, run }
}

/** The draft with the picker's colour and photo; the type only changes through `onTypePick`. */
function withLook(draft: NewBotDraft, next: AvatarValue): NewBotDraft {
  const { image: _image, ...rest } = draft
  return {
    ...rest,
    avatar: { type: draft.avatar.type, ...(next.color ? { color: next.color } : {}) },
    ...(next.photo ? { image: next.photo } : {})
  }
}

interface HandleLineProps {
  handle: string
  editing: boolean
  onEdit: () => void
  onChange: (value: string) => void
  error: string | undefined
}

function HandleLine({ handle, editing, onEdit, onChange, error }: HandleLineProps) {
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      {editing ? (
        <>
          <label htmlFor="bot-handle" className="sr-only">Handle</label>
          <Input id="bot-handle" value={handle} onChange={e => onChange(e.target.value)} aria-invalid={error ? true : undefined} />
        </>
      ) : (
        <div className="flex items-center gap-2">
          <span>{handle ? `@${handle}` : 'Handle: —'}</span>
          <button type="button" onClick={onEdit} className="rounded-full underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring">Change handle</button>
        </div>
      )}
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </div>
  )
}

interface PartialNoticeProps {
  result: CreateResult
  busy: boolean
  onFinish: () => void
  onOpen: () => void
}

/** The bot exists but a step failed, or it still needs a model. */
function PartialNotice({ result, busy, onFinish, onOpen }: PartialNoticeProps) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-background p-3 text-sm">
      {result.error && <p>{`Created @${result.name}, but ${result.error.step} failed: ${result.error.message}`}</p>}
      {result.needsModel && <p>This bot needs a model before it can reply</p>}
      <div className="flex justify-end gap-2">
        {!result.complete && <Button type="button" disabled={busy} onClick={onFinish}>Finish setup</Button>}
        <Button type="button" variant="outline" onClick={onOpen}>Open bot</Button>
      </div>
    </div>
  )
}

/**
 * Draft changes that build on the newest draft. A photo is prepared in the background and a type pick
 * sends two changes in one click, so a change made from the draft of an earlier render would drop the other.
 */
function useDraftChanges(draft: NewBotDraft, onDraft: (draft: NewBotDraft) => void) {
  const latest = useRef(draft)
  useLayoutEffect(() => {
    latest.current = draft
  })
  const emit = (next: NewBotDraft) => {
    latest.current = next
    onDraft(next)
  }
  return {
    patch: (change: Partial<NewBotDraft>) => emit({ ...latest.current, ...change }),
    look: (next: AvatarValue) => emit(withLook(latest.current, next)),
    type: (type: AvatarType) => emit({ ...latest.current, avatar: { ...latest.current.avatar, type } })
  }
}

interface FieldsProps {
  draft: NewBotDraft
  handle: string
  handleError: string | undefined
  avatar: AvatarValue
  changes: ReturnType<typeof useDraftChanges>
  /** A name or handle change, which makes the last refusal out of date. */
  onIdentity: (change: Partial<NewBotDraft>) => void
  onPhotoBusy: (busy: boolean) => void
}

function Fields({ draft, handle, handleError, avatar, changes, onIdentity, onPhotoBusy }: FieldsProps) {
  const rename = (name: string) => onIdentity({ name, ...(draft.handleEdited ? {} : { handle: slugifyProfileName(name) }) })
  return (
    <>
      <div className={FIELD}>
        <label htmlFor="bot-name" className={LABEL}>Name</label>
        <Input id="bot-name" value={draft.name} maxLength={80} onChange={e => rename(e.target.value)} />
        <HandleLine handle={handle} editing={draft.handleEdited} onEdit={() => onIdentity({ handle, handleEdited: true })} onChange={value => onIdentity({ handle: value, handleEdited: true })} error={handleError} />
      </div>
      <div className={FIELD}>
        <label htmlFor="bot-mission" className={LABEL}>Job &amp; personality</label>
        <Textarea id="bot-mission" value={draft.mission} maxLength={2000} onChange={e => changes.patch({ mission: e.target.value })} placeholder="What does it do? e.g. Research assistant who finds papers about agents." />
      </div>
      <div className={FIELD}>
        <span className={LABEL}>Avatar</span>
        <AvatarPicker value={avatar} onChange={changes.look} onBusyChange={onPhotoBusy} onTypePick={changes.type} />
      </div>
      <div className={FIELD}>
        <span className={LABEL}>Role <span className="font-medium text-muted-foreground">(optional)</span></span>
        <div className="rounded-2xl bg-background p-1">
          <RolePicker value={draft.role} onChange={role => changes.patch({ role })} />
        </div>
      </div>
      <div className={FIELD}>
        <span id="bot-model-label" className={LABEL}>Model</span>
        <ModelSelect value={draft.model} onChange={model => changes.patch({ model })} allowDefault />
      </div>
    </>
  )
}

/** The New bot fields and the create flow: name and handle, job, look, role, model and sandbox. */
export function NewBotForm({ draft, onDraft, onCreated, onPartial, onBusyChange }: NewBotFormProps) {
  const changes = useDraftChanges(draft, onDraft)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [sandboxReady, setSandboxReady] = useState(true)
  const flow = useCreateFlow({ onCreated, onPartial, onBusyChange })

  const handle = draft.handleEdited ? draft.handle : slugifyProfileName(draft.name)
  const check = validateBotName(handle)
  const touched = draft.name.trim() !== '' || draft.handleEdited
  // In Hermes the display name is ui_meta.title; the handle is the profile name.
  const title = draft.name.trim()
  const avatar: AvatarValue = { type: draft.avatar.type ?? deriveAvatarType(handle), ...(draft.avatar.color ? { color: draft.avatar.color } : {}), photo: draft.image ?? null }
  const image = draft.image ? { image: draft.image } : {}
  const choice = { type: avatar.type, ...(avatar.color ? { color: avatar.color } : {}) }
  const forget = (change: Partial<NewBotDraft>) => {
    flow.setFailure({})
    changes.patch(change)
  }

  const create = () => flow.run(() => createBot({ name: handle, title, mission: draft.mission, avatar: choice, ...image, role: draft.role, ...(draft.model ? { model: draft.model } : {}), sandbox: draft.sandbox }))
  // The role is stored with the look, so a failed look step loses it: send it again once setup has finished.
  const finish = (botName: string) => flow.run(async () => {
    const result = await finishBot(botName, { avatar: choice, title, ...image })
    if (result.complete && draft.role) await updateBot(botName, { role: draft.role })
    return result
  })

  return (
    <div className="flex flex-col gap-4">
      <Fields
        draft={draft} handle={handle} handleError={!check.ok && touched ? NAME_MESSAGES[check.reason] : flow.failure.handle}
        avatar={avatar} changes={changes} onIdentity={forget} onPhotoBusy={setPhotoBusy}
      />
      <SandboxChoice checked={draft.sandbox} onChange={sandbox => forget({ sandbox })} onReadyChange={setSandboxReady} />
      <div className={FOOTER}>
        {flow.failure.general && <p role="alert" className="text-sm text-destructive">{flow.failure.general}</p>}
        {flow.partial ? (
          <PartialNotice result={flow.partial} busy={flow.busy || photoBusy} onFinish={() => void finish(flow.partial!.name)} onOpen={() => onCreated(flow.partial!.name)} />
        ) : (
          <Button type="button" className="w-full" disabled={flow.busy || photoBusy || !check.ok || !sandboxReady} onClick={() => void create()}>Create</Button>
        )}
      </div>
    </div>
  )
}
