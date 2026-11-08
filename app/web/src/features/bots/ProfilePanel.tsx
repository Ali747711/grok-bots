import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import type { BotView } from '@/state/types'

import { finishBot, updateBot } from './bots-api'
import { DeleteBotDialog } from './DeleteBotDialog'
import { ProfileFields } from './ProfileFields'
import { buildPatch, freshSync, hasChanges, mergeFresh, type FormSync, type ProfileForm } from './profile-form'
import { ProfileLook } from './ProfileLook'
import { ConfirmModelDialog, ConflictBanner } from './ProfileNotices'
import { useBotDetail } from './use-bot-detail'
import { failureText, useProfileSave } from './use-profile-save'
import type { BotDetail } from './types'

const handleOf = (bot: BotView) => (bot.isPrimary ? 'hermes' : bot.name)

function HideSection({ detail, onDetail }: { detail: BotDetail; onDetail: (d: BotDetail) => void }) {
  const [error, setError] = useState<string | null>(null)
  const toggle = async () => {
    setError(null)
    try {
      const out = await updateBot(detail.name, { hidden: !detail.hidden })
      if (out.status === 'saved') onDetail(out.detail)
      else setError(failureText(null))
    } catch (e) {
      setError(failureText(e))
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-sm">
        <span>{detail.hidden ? 'Hidden from the list' : 'Shown in the list'}</span>
        <Button type="button" size="sm" variant="outline" onClick={() => void toggle()}>{detail.hidden ? 'Show' : 'Hide'}</Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

interface LoadedProps {
  bot: BotView
  detail: BotDetail
  setDetail: (d: BotDetail) => void
  reload: () => Promise<BotDetail | null>
}

function FinishSetup({ onFinish }: { onFinish: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null)
  const run = async () => {
    setError(null)
    try {
      await onFinish()
    } catch (e) {
      setError(failureText(e))
    }
  }
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border p-3 text-sm">
      <div className="flex items-center justify-between">
        <span>Setup was not finished.</span>
        <Button type="button" size="sm" onClick={() => void run()}>Finish setup</Button>
      </div>
      {error && <p role="alert" className="text-destructive">{error}</p>}
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
  const [photoBusy, setPhotoBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { form } = sync
  const saver = useProfileSave({ name: bot.name, onReset: reset, reload: reloadMerged })
  const patch = buildPatch(form, sync.loaded)

  const finish = async () => {
    await finishBot(bot.name, { title: form.name.trim(), look: form.look })
    await reloadMerged()
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {bot.setupIncomplete && !bot.isPrimary && <FinishSetup onFinish={finish} />}
      <ProfileLook
        detail={detail} look={form.look} onLook={look => edit({ look })} onDetail={refreshed} onBusyChange={setPhotoBusy}
        initial={form.name.trim().charAt(0).toUpperCase() || '?'}
      />
      <ProfileFields form={form} handle={handleOf(bot)} allowDefault={detail.model === null} onChange={edit} />
      {saver.conflict && <ConflictBanner conflict={saver.conflict} busy={saver.busy} onReload={saver.takeTheirs} onSaveAnyway={saver.saveAnyway} />}
      {saver.error && <p role="alert" className="text-sm text-destructive">{saver.error}</p>}
      <Button type="button" disabled={saver.busy || photoBusy || !hasChanges(patch)} onClick={() => void saver.send(patch)}>Save</Button>
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

/** Edit one bot's profile. Name, job, persona, model and look save together; photo, hide and delete act at once. */
export function ProfilePanel({ bot }: { bot: BotView }) {
  const { detail, error, reload, setDetail } = useBotDetail(bot.name)
  if (!detail) return <p className="p-4 text-sm text-muted-foreground">{error ? 'Could not load this bot.' : 'Loading…'}</p>
  return <Loaded bot={bot} detail={detail} setDetail={setDetail} reload={reload} />
}
