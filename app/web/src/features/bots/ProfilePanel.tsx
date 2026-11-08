import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import type { BotView } from '@/state/types'

import { finishBot, updateBot } from './bots-api'
import { DeleteBotDialog } from './DeleteBotDialog'
import { ProfileFields } from './ProfileFields'
import { buildPatch, fromDetail, hasChanges, type ProfileForm } from './profile-form'
import { ProfileLook } from './ProfileLook'
import { ConfirmModelDialog, ConflictBanner } from './ProfileNotices'
import { useBotDetail } from './use-bot-detail'
import { useProfileSave } from './use-profile-save'
import type { BotDetail } from './types'

const handleOf = (bot: BotView) => (bot.isPrimary ? 'hermes' : bot.name)

function HideSection({ detail, onDetail }: { detail: BotDetail; onDetail: (d: BotDetail) => void }) {
  const toggle = async () => {
    const out = await updateBot(detail.name, { hidden: !detail.hidden }).catch(() => null)
    if (out?.status === 'saved') onDetail(out.detail)
  }
  return (
    <div className="flex items-center justify-between text-sm">
      <span>{detail.hidden ? 'Hidden from the list' : 'Shown in the list'}</span>
      <Button type="button" size="sm" variant="outline" onClick={() => void toggle()}>{detail.hidden ? 'Show' : 'Hide'}</Button>
    </div>
  )
}

function Loaded({ bot, detail, setDetail, reload }: { bot: BotView; detail: BotDetail; setDetail: (d: BotDetail) => void; reload: () => Promise<BotDetail | null> }) {
  const navigate = useNavigate()
  const [form, setForm] = useState<ProfileForm>(() => fromDetail(detail))
  const [photoBusy, setPhotoBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const saver = useProfileSave({ name: bot.name, setDetail, setForm, reload })
  const patch = buildPatch(form, detail)
  const edit = (change: Partial<ProfileForm>) => setForm(f => ({ ...f, ...change }))

  const finish = async () => {
    await finishBot(bot.name, { title: form.name.trim(), look: form.look }).catch(() => null)
    await reload()
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {bot.setupIncomplete && !bot.isPrimary && (
        <div className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
          <span>Setup was not finished.</span>
          <Button type="button" size="sm" onClick={() => void finish()}>Finish setup</Button>
        </div>
      )}
      <ProfileLook
        detail={detail} look={form.look} onLook={look => edit({ look })} onDetail={setDetail} onBusyChange={setPhotoBusy}
        initial={form.name.trim().charAt(0).toUpperCase() || '?'}
      />
      <ProfileFields form={form} handle={handleOf(bot)} allowDefault={detail.model === null} onChange={edit} />
      {saver.conflict && <ConflictBanner conflict={saver.conflict} busy={saver.busy} onReload={saver.takeTheirs} onSaveAnyway={saver.saveAnyway} />}
      {saver.error && <p role="alert" className="text-sm text-destructive">{saver.error}</p>}
      <Button type="button" disabled={saver.busy || photoBusy || !hasChanges(patch)} onClick={() => void saver.send(patch)}>Save</Button>
      <HideSection detail={detail} onDetail={setDetail} />
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
