import { CrewAvatar } from '@/features/avatars/CrewAvatar'
import { ROLE_LABELS } from '@/features/bots/roles'
import type { BotDetail } from '@/features/bots/types'
import { shortModel } from '@/features/chat/model-name'
import type { BotView } from '@/state/types'

import { type ApprovalMode, SLEEP_LABEL, sleepChoice } from './profile-api'
import type { ProfileSettings } from './use-profile-settings'

interface SummaryCardProps {
  bot: BotView
  detail: BotDetail
  handle: string
  settings: ProfileSettings
}

const JOB_EXCERPT = 120
const UNKNOWN = '—'
const APPROVAL_SUMMARY: Readonly<Record<ApprovalMode, string>> = { manual: 'Asks first', smart: 'Checker decides first', off: 'Never asks' }
const SANDBOX_SUMMARY: Readonly<Record<NonNullable<BotView['sandbox']>, string>> = { on: 'On', off: 'Off', partial: 'Partly on' }

/** The text cut to `max` characters, ending in an ellipsis when something was cut. */
export function excerpt(text: string, max: number): string {
  const flat = text.trim().replace(/\s+/g, ' ')
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`
}

const appsText = (n: number | null): string => (n === null ? UNKNOWN : `${n} ${n === 1 ? 'app' : 'apps'} connected`)

/**
 * The bot at a glance, beside the tabs: its saved name, role, model and job, and the settings the
 * Advanced and Apps tabs hold. Hidden when the profile is narrower than 820 px.
 */
export function SummaryCard({ bot, detail, handle, settings }: SummaryCardProps) {
  const meta = [detail.role ? ROLE_LABELS[detail.role] : null, shortModel(detail.model?.model ?? bot.model)].filter((part): part is string => part !== null).join(' · ')
  const job = excerpt(detail.description, JOB_EXCERPT)
  const facts = [
    { label: 'Sandbox', value: bot.sandbox ? SANDBOX_SUMMARY[bot.sandbox] : UNKNOWN },
    { label: 'Apps', value: appsText(settings.appsOn) },
    { label: 'Approvals', value: settings.approvals ? APPROVAL_SUMMARY[settings.approvals.mode] : UNKNOWN },
    { label: 'Screen stops after', value: settings.screen ? SLEEP_LABEL[sleepChoice(settings.screen.idleStopMinutes)] : UNKNOWN }
  ]
  return (
    <aside aria-label={`${detail.title} at a glance`} className="flex w-[280px] shrink-0 flex-col overflow-y-auto rounded-2xl bg-background p-1.5 @max-[820px]/profile:hidden">
      <div className="flex h-44 shrink-0 items-center justify-center rounded-[18px] bg-shell">
        <CrewAvatar bot={bot} size={96} decorative />
      </div>
      <div className="px-3 pt-4 pb-3 text-center">
        <p className="truncate text-lg font-semibold tracking-tight">{detail.title}</p>
        <p className="truncate text-[13px] font-medium text-muted-foreground">{`@${handle}`}</p>
        {meta && <p className="truncate text-[13px] font-medium text-faint">{meta}</p>}
        {job && <p className="mt-2 text-xs font-medium text-muted-foreground">{job}</p>}
      </div>
      <dl className="flex flex-col gap-0.5">
        {facts.map(fact => (
          <div key={fact.label} className="flex h-9 items-center justify-between gap-3 rounded-full px-3 text-[13px] font-medium">
            <dt className="shrink-0 text-faint">{fact.label}</dt>
            <dd className="truncate text-muted-foreground">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  )
}
