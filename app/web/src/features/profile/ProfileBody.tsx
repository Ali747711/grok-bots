import { IdCard, type LucideIcon, Plug, SlidersHorizontal, Smile, Sparkles } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

import { SegmentedTabs } from '@/components/console/segmented-tabs'
import { AppsSection } from '@/features/bots/AppsSection'
import { ProfileAvatar } from '@/features/bots/ProfileAvatar'
import { ConfirmModelDialog } from '@/features/bots/ProfileNotices'
import type { BotDetail } from '@/features/bots/types'
import type { BotView } from '@/state/types'

import { AdvancedTab } from './AdvancedTab'
import { FinishSetupBanner } from './FinishSetupBanner'
import { IdentityTab } from './IdentityTab'
import { dropProfileDraft } from './profile-drafts'
import { SaveBar } from './SaveBar'
import { SoulTab } from './SoulTab'
import { SummaryCard } from './SummaryCard'
import { useProfileEditor } from './use-profile-editor'
import { useProfileSettings } from './use-profile-settings'

/** The tabs built so far; Skills joins them in Task 14. */
export type ShownTab = 'identity' | 'avatar' | 'soul' | 'apps' | 'advanced'

export const PROFILE_TABS: { id: ShownTab; label: string; icon: LucideIcon }[] = [
  { id: 'identity', label: 'Identity', icon: IdCard },
  { id: 'avatar', label: 'Avatar', icon: Smile },
  { id: 'soul', label: 'Soul', icon: Sparkles },
  { id: 'apps', label: 'Apps', icon: Plug },
  { id: 'advanced', label: 'Advanced', icon: SlidersHorizontal }
]

/** The two kinds of saving, said plainly (spec §7.4). */
const SAVING_NOTE: Record<ShownTab, string> = {
  identity: 'Changes here wait for Save.',
  soul: 'Changes here wait for Save.',
  avatar: 'Changes here apply at once.',
  apps: 'Changes here apply at once.',
  advanced: 'Changes here apply at once.'
}

const handleOf = (bot: BotView) => (bot.isPrimary ? 'hermes' : bot.name)
const DIALOGS = '[role=dialog], [role=alertdialog]'

interface ProfileBodyProps {
  bot: BotView
  detail: BotDetail
  setDetail: (detail: BotDetail) => void
  reload: () => Promise<BotDetail | null>
  tab: ShownTab
  onTab: (tab: ShownTab) => void
}

/** The loaded profile: tabs, the summary card, the tab in view and the one save bar for the text fields. */
export function ProfileBody({ bot, detail, setDetail, reload, tab, onTab }: ProfileBodyProps) {
  const navigate = useNavigate()
  const editor = useProfileEditor({ name: bot.name, detail, setDetail, reload })
  const settings = useProfileSettings(bot.name)
  const { saver } = editor
  const unfinished = bot.setupIncomplete && !bot.isPrimary
  const { reload: reloadSettings } = settings

  // The Apps tab and the Sandbox section write on their own: re-read what the card and Approvals show
  // when the tab or the sandbox state changes (the first read is the hook's own).
  const settled = useRef(false)
  useEffect(() => {
    if (settled.current) void reloadSettings()
    settled.current = true
  }, [tab, bot.sandbox, reloadSettings])

  // ⌘↵ saves from anywhere in the profile, fields included (R7); a dialog keeps its own keys.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
    if (event.target instanceof Element && event.target.closest(DIALOGS)) return
    if (!editor.dirty) return
    event.preventDefault()
    editor.save()
  }
  const onDeleted = () => {
    dropProfileDraft(bot.name)
    navigate('/')
  }
  const text = { form: editor.form, title: detail.title, onChange: editor.edit }

  return (
    <div onKeyDown={onKeyDown} className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 overflow-x-auto px-3 pb-2">
        <SegmentedTabs tabs={PROFILE_TABS} value={tab} onChange={onTab} label={`${detail.title}'s profile`} idPrefix="profile" />
      </div>
      <div className="flex min-h-0 flex-1 gap-2 px-2 pb-2">
        <SummaryCard bot={bot} detail={detail} handle={handleOf(bot)} settings={settings} />
        <div id="profile-panel" role="tabpanel" aria-labelledby={`profile-tab-${tab}`} className="flex min-w-0 flex-1 flex-col overflow-y-auto rounded-2xl bg-background">
          <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-7 p-5">
            {unfinished && <FinishSetupBanner onFinish={editor.finish} />}
            <p className="px-1 text-xs font-medium text-faint">{SAVING_NOTE[tab]}</p>
            {tab === 'identity' && <IdentityTab {...text} handle={handleOf(bot)} allowDefault={detail.model === null} />}
            {/* Always mounted: a save in flight or a pick held for Finish setup must outlive a tab switch. */}
            <div hidden={tab !== 'avatar'} className="flex flex-col gap-4">
              <ProfileAvatar
                detail={detail} onDetail={editor.refreshed} onBusyChange={editor.avatar.setBusy} disabled={saver.busy}
                held={unfinished} heldChoice={editor.avatar.held} onHeld={editor.avatar.setHeld}
              />
            </div>
            {tab === 'soul' && <SoulTab {...text} />}
            {tab === 'apps' && <AppsSection bot={bot.name} title={detail.title} sandboxed={bot.sandbox === 'on'} />}
            {tab === 'advanced' && <AdvancedTab detail={detail} isPrimary={bot.isPrimary} settings={settings} reloadBot={editor.reloadMerged} onDeleted={onDeleted} />}
          </div>
          <SaveBar
            dirty={editor.dirty} busy={editor.busy} error={saver.error} conflict={saver.conflict}
            onSave={editor.save} onDiscard={editor.discard} onReload={saver.takeTheirs} onSaveAnyway={saver.saveAnyway}
          />
        </div>
      </div>
      <ConfirmModelDialog confirm={saver.confirm} busy={saver.busy} onConfirm={saver.useConfirmed} onCancel={saver.cancelConfirm} />
    </div>
  )
}
