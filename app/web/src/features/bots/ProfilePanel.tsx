import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { deriveAvatarType } from '@/features/avatars/avatar-model'
import type { BotView } from '@/state/types'

import { finishBot, updateBot } from './bots-api'
import { DeleteBotDialog } from './DeleteBotDialog'
import { ProfileAvatar } from './ProfileAvatar'
import { ProfileFields } from './ProfileFields'
import { buildPatch, freshSync, hasChanges, mergeFresh, type FormSync, type ProfileForm } from './profile-form'
import { ConfirmModelDialog, ConflictBanner } from './ProfileNotices'
import { useBotDetail } from './use-bot-detail'
import { failureText, useProfileSave } from './use-profile-save'
import type { AvatarChoice, BotDetail } from './types'

const handleOf = (bot: BotView) => (bot.isPrimary ? 'hermes' : bot.name)

function ErrorAlert({ children }: { children: string }) {
  return <Alert variant="destructive"><AlertDescription>{children}</AlertDescription></Alert>
}

function HideSection({ detail, onDetail }: { detail: BotDetail; onDetail: (d: BotDetail) => void }) {
  const [error, setError] = useState<string | null>(null)
  const toggle = async () => {
    setError(null)
    try {
      const out = await updateBot(detail.name, { hidden: !detail.hidden })
      if (out.status === 'saved') {
        onDetail(out.detail)
        toast.success(out.detail.hidden ? 'Bot hidden' : 'Bot shown')
      } else setError(failureText(null))
    } catch (e) {
      setError(failureText(e))
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-sm">
        <span id="hide-label">Hide from the list</span>
        <Switch
          checked={detail.hidden}
          onCheckedChange={() => void toggle()}
          aria-labelledby="hide-label"
          className="data-checked:bg-foreground data-unchecked:border-muted-foreground"
        />
      </div>
      {error && <ErrorAlert>{error}</ErrorAlert>}
    </div>
  )
}

interface LoadedProps {
  bot: BotView
  detail: BotDetail
  setDetail: (d: BotDetail) => void
  reload: () => Promise<BotDetail | null>
}

function FinishSetup({ onFinish }: { onFinish: () => Promise<string | null> }) {
  const [error, setError] = useState<string | null>(null)
  const run = async () => {
    setError(null)
    try {
      const problem = await onFinish()
      if (problem) setError(`Finish setup didn't complete: ${problem}`)
    } catch (e) {
      setError(failureText(e))
    }
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-muted p-3 text-sm">
      <div className="flex items-center justify-between">
        <span>Setup was not finished.</span>
        <Button type="button" size="sm" onClick={() => void run()}>Finish setup</Button>
      </div>
      {error && <ErrorAlert>{error}</ErrorAlert>}
    </div>
  )
}

/** Form state next to its start values. Refreshes keep edits and their original baselines. */
function useProfileSync({ detail, setDetail, reload }: Omit<LoadedProps, 'bot'>) {
  const [sync, setSync] = useState<FormSync>(() => freshSync(detail))
  const refreshed = (d: BotDetail) => {
    setDetail(d)
    setSync(s => mergeFresh(s, d))
  }
  const reset = (d: BotDetail) => {
    setDetail(d)
    setSync(freshSync(d))
  }
  const reloadMerged = async () => {
    const d = await reload()
    if (d) setSync(s => mergeFresh(s, d))
    return d
  }
  const edit = (change: Partial<ProfileForm>) => setSync(s => ({ ...s, form: { ...s.form, ...change } }))
  return { sync, refreshed, reset, reloadMerged, edit }
}

function Loaded({ bot, detail, setDetail, reload }: LoadedProps) {
  const navigate = useNavigate()
  const { sync, refreshed, reset, reloadMerged, edit } = useProfileSync({ detail, setDetail, reload })
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [held, setHeld] = useState<AvatarChoice | null>(null)
  const [deleting, setDeleting] = useState(false)
  const { form } = sync
  const saver = useProfileSave({ name: bot.name, onReset: reset, reload: reloadMerged })
  const patch = buildPatch(form, sync.loaded)

  const finish = async () => {
    // The picker's current value: the stored avatar, else the derived type with no colour.
    const avatar = held ?? detail.avatar ?? { type: deriveAvatarType(bot.name) }
    const result = await finishBot(bot.name, { title: form.name.trim(), avatar })
    if (result.complete) setHeld(null)
    await reloadMerged()
    return result.complete ? null : (result.error?.message ?? 'a step failed')
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {bot.setupIncomplete && !bot.isPrimary && <FinishSetup onFinish={finish} />}
      <ProfileAvatar
        detail={detail} onDetail={refreshed} onBusyChange={setAvatarBusy} disabled={saver.busy}
        held={bot.setupIncomplete && !bot.isPrimary} heldChoice={held} onHeld={setHeld}
      />
      <ProfileFields form={form} handle={handleOf(bot)} allowDefault={detail.model === null} onChange={edit} />
      {saver.conflict && <ConflictBanner conflict={saver.conflict} busy={saver.busy} onReload={saver.takeTheirs} onSaveAnyway={saver.saveAnyway} />}
      {saver.error && <ErrorAlert>{saver.error}</ErrorAlert>}
      <Button type="button" disabled={saver.busy || avatarBusy || !hasChanges(patch)} onClick={() => void saver.send(patch)}>Save</Button>
      <HideSection detail={detail} onDetail={refreshed} />
      {!bot.isPrimary && (
        <>
          <Button type="button" variant="destructive" onClick={() => setDeleting(true)}>Delete bot</Button>
          <DeleteBotDialog name={bot.name} title={detail.title} open={deleting} onOpenChange={setDeleting} onDeleted={() => navigate('/')} />
        </>
      )}
      <ConfirmModelDialog confirm={saver.confirm} busy={saver.busy} onConfirm={saver.useConfirmed} onCancel={saver.cancelConfirm} />
    </div>
  )
}

/** Edit one bot's profile. Name, job, persona and model save together; avatar, hide and delete act at once. */
export function ProfilePanel({ bot }: { bot: BotView }) {
  const { detail, error, reload, setDetail } = useBotDetail(bot.name)
  if (!detail) return <p className="p-4 text-sm text-muted-foreground">{error ? 'Could not load this bot.' : 'Loading…'}</p>
  return <Loaded bot={bot} detail={detail} setDetail={setDetail} reload={reload} />
}
