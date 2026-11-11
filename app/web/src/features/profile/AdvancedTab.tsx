import { SandboxSection } from '@/features/bots/SandboxSection'
import type { BotDetail } from '@/features/bots/types'

import { ApprovalsSection } from './ApprovalsSection'
import { ComputerSection } from './ComputerSection'
import { DangerZone } from './DangerZone'
import { HideSection } from './HideSection'
import type { ProfileSettings } from './use-profile-settings'

interface AdvancedTabProps {
  detail: BotDetail
  isPrimary: boolean
  settings: ProfileSettings
  /** Re-reads the bot after Hide; null when it could not be read. */
  reloadBot: () => Promise<BotDetail | null>
  /** Takes the bot as a Hide write answered it. */
  onDetail: (detail: BotDetail) => void
  onDeleted: () => void
}

/**
 * What the bot may do on its own, and the irreversible bits. Every control here applies at once.
 * The sections are siblings with nothing wrapping them all in a `<section>`: the sandbox e2e finds
 * the Sandbox section as the one `<section>` that holds its heading.
 */
export function AdvancedTab({ detail, isPrimary, settings, reloadBot, onDetail, onDeleted }: AdvancedTabProps) {
  const { name, title } = detail
  const { reload, apply } = settings
  return (
    <>
      <ApprovalsSection name={name} title={title} isPrimary={isPrimary} approvals={settings.approvals} readError={settings.errors.approvals} reload={reload} onWritten={approvals => apply({ approvals })} />
      <ComputerSection name={name} title={title} isPrimary={isPrimary} screen={settings.screen} readError={settings.errors.screen} reload={reload} onWritten={screen => apply({ screen })} />
      <SandboxSection bot={name} title={title} />
      <HideSection detail={detail} reload={reloadBot} onDetail={onDetail} />
      {!isPrimary && <DangerZone name={name} title={title} onDeleted={onDeleted} />}
    </>
  )
}
