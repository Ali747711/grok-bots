import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { deriveAvatarType, type AvatarType } from '@/features/avatars/avatar-model'
import { AvatarPicker, type AvatarValue } from '@/features/avatars/AvatarPicker'

import { createBot, finishBot } from './bots-api'
import { describeCreateFailure } from './create-errors'
import { ModelSelect } from './ModelSelect'
import { NAME_MESSAGES, slugifyProfileName, validateBotName } from './slug'
import type { CreateResult, ModelChoice } from './types'

interface NewBotDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The bot exists (complete, or the user chose to open a half-made one). */
  onCreated: (name: string) => void
}

const FIELD = 'flex flex-col gap-1.5'
const LABEL = 'text-sm font-medium'

interface Failure {
  handle?: string
  general?: string
}

/** Busy flag, failure text and the partial result for create / finish calls. */
function useCreateFlow({ onOpenChange, onCreated }: Omit<NewBotDialogProps, 'open'>) {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Failure>({})
  const [partial, setPartial] = useState<CreateResult | null>(null)

  const run = async (action: () => Promise<CreateResult>) => {
    setBusy(true)
    setFailure({})
    try {
      const result = await action()
      if (result.complete && !result.needsModel) {
        onOpenChange(false)
        onCreated(result.name)
      } else {
        setPartial(result)
      }
    } catch (error) {
      setFailure(describeCreateFailure(error))
    } finally {
      setBusy(false)
    }
  }
  return { busy, failure, setFailure, partial, run }
}

interface FieldsProps {
  name: string
  onName: (v: string) => void
  handle: string
  editingHandle: boolean
  onEditHandle: (v: string) => void
  handleError: string | undefined
  mission: string
  onMission: (v: string) => void
  avatar: AvatarValue
  onAvatar: (v: AvatarValue) => void
  onTypePick: (type: AvatarType) => void
  model: ModelChoice | null
  onModel: (v: ModelChoice | null) => void
  onPhotoBusy: (busy: boolean) => void
}

function BotFields(f: FieldsProps) {
  return (
    <>
      <div className={FIELD}>
        <label htmlFor="bot-name" className={LABEL}>Name</label>
        <Input id="bot-name" value={f.name} maxLength={80} onChange={e => f.onName(e.target.value)} autoFocus />
        <HandleLine handle={f.handle} editing={f.editingHandle} onEdit={() => f.onEditHandle(f.handle)} onChange={f.onEditHandle} error={f.handleError} />
      </div>
      <div className={FIELD}>
        <label htmlFor="bot-mission" className={LABEL}>Job &amp; personality</label>
        <Textarea id="bot-mission" value={f.mission} maxLength={2000} onChange={e => f.onMission(e.target.value)} placeholder="What does it do? e.g. Research assistant who finds papers about agents." />
      </div>
      <div className={FIELD}>
        <span className={LABEL}>Avatar</span>
        <AvatarPicker value={f.avatar} onChange={f.onAvatar} onBusyChange={f.onPhotoBusy} onTypePick={f.onTypePick} />
      </div>
      <div className={FIELD}>
        <label htmlFor="bot-model" className={LABEL}>Model</label>
        <ModelSelect value={f.model} onChange={f.onModel} allowDefault />
      </div>
    </>
  )
}

function NewBotForm(props: Omit<NewBotDialogProps, 'open'>) {
  const { onOpenChange, onCreated } = props
  const [name, setName] = useState('')
  const [handleEdit, setHandleEdit] = useState<string | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [mission, setMission] = useState('')
  // The type follows the handle until the user picks one.
  const [pickedType, setPickedType] = useState<AvatarType | null>(null)
  const [look, setLook] = useState<{ color?: string; photo?: string | null }>({})
  const [model, setModel] = useState<ModelChoice | null>(null)
  const flow = useCreateFlow(props)

  const handle = handleEdit ?? slugifyProfileName(name)
  const check = validateBotName(handle)
  const touched = name.trim() !== '' || handleEdit !== null
  // In Hermes the display name is ui_meta.title; the handle is the profile name.
  const finalTitle = name.trim()
  const avatar: AvatarValue = { ...look, type: pickedType ?? deriveAvatarType(handle) }
  const image = avatar.photo ? { image: avatar.photo } : {}
  const choice = { type: avatar.type, ...(avatar.color ? { color: avatar.color } : {}) }
  const forget = <T,>(set: (v: T) => void) => (v: T) => { set(v); flow.setFailure({}) }

  const create = () => flow.run(() => createBot({ name: handle, title: finalTitle, mission, avatar: choice, ...image, ...(model ? { model } : {}) }))
  const finish = (botName: string) => flow.run(() => finishBot(botName, { avatar: choice, title: finalTitle, ...image }))

  return (
    <>
      <BotFields
        name={name} onName={forget(setName)} handle={handle} editingHandle={handleEdit !== null} onEditHandle={forget(setHandleEdit)}
        handleError={!check.ok && touched ? NAME_MESSAGES[check.reason] : flow.failure.handle}
        mission={mission} onMission={setMission} avatar={avatar} onAvatar={next => setLook({ color: next.color, photo: next.photo })} onTypePick={setPickedType} model={model} onModel={setModel}
        onPhotoBusy={setPhotoBusy}
      />
      {flow.failure.general && <p role="alert" className="text-sm text-destructive">{flow.failure.general}</p>}
      {flow.partial ? (
        <PartialNotice result={flow.partial} busy={flow.busy || photoBusy} onFinish={() => void finish(flow.partial!.name)} onOpen={() => { onOpenChange(false); onCreated(flow.partial!.name) }} />
      ) : (
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={flow.busy || photoBusy || !check.ok} onClick={() => void create()}>Create</Button>
        </div>
      )}
    </>
  )
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
          <button type="button" onClick={onEdit} className="underline">Change handle</button>
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
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
      {result.error && <p>{`Created @${result.name}, but ${result.error.step} failed: ${result.error.message}`}</p>}
      {result.needsModel && <p>This bot needs a model before it can reply</p>}
      <div className="flex justify-end gap-2">
        {!result.complete && <Button type="button" disabled={busy} onClick={onFinish}>Finish setup</Button>}
        <Button type="button" variant="outline" onClick={onOpen}>Open bot</Button>
      </div>
    </div>
  )
}

/** Create a bot: name and handle, job, look and model. */
export function NewBotDialog({ open, onOpenChange, onCreated }: NewBotDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New bot</DialogTitle>
          <DialogDescription>Give it a name, a job and an avatar.</DialogDescription>
        </DialogHeader>
        <NewBotForm onOpenChange={onOpenChange} onCreated={onCreated} />
      </DialogContent>
    </Dialog>
  )
}
