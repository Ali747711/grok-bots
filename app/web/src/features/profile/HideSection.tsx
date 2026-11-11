import { useId } from 'react'
import { toast } from 'sonner'

import { Section, Switch } from '@/components/console/fields'
import { updateBot } from '@/features/bots/bots-api'
import type { BotDetail } from '@/features/bots/types'

import { RowError, RowNotice } from './RowNotes'
import { useProfileRowAction } from './use-profile-row-action'

interface HideSectionProps {
  detail: BotDetail
  /** Re-reads the bot, so the switch shows what Hermes holds; null when it could not be read. */
  reload: () => Promise<BotDetail | null>
  /** Takes the bot as the write answered it, before the re-read confirms it. */
  onDetail: (detail: BotDetail) => void
}

/** Hide the bot from the rail's main list. Applies at once. */
export function HideSection({ detail, reload, onDetail }: HideSectionProps) {
  const { pending, error, notice, run } = useProfileRowAction({ title: detail.title, reload: async () => (await reload()) !== null })
  const hintId = useId()
  const toggle = async (hidden: boolean) => {
    const saved = await run(async () => {
      const out = await updateBot(detail.name, { hidden })
      // A lone `hidden` is not a guarded field, so anything but "saved" is a failure.
      if (out.status !== 'saved') throw new Error('not saved')
      onDetail(out.detail)
    })
    if (saved) toast.success(hidden ? 'Bot hidden' : 'Bot shown')
  }
  return (
    <Section title="Hide">
      <div className="flex items-center justify-between gap-3 rounded-2xl px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold">Hide from the list</p>
          <p id={hintId} className="text-xs font-medium text-faint">{`${detail.title} moves to Hidden in the rail. It keeps working.`}</p>
        </div>
        <Switch label="Hide from the list" describedBy={hintId} checked={detail.hidden} disabled={pending} onChange={next => void toggle(next)} />
      </div>
      {error && <RowError>{error}</RowError>}
      {notice && <RowNotice>{notice}</RowNotice>}
    </Section>
  )
}
