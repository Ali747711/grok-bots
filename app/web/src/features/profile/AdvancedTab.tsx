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
  /** Re-reads the bot after Hide. */
  reloadBot: () => Promise<unknown>
  onDeleted: () => void
}

/**
 * What the bot may do on its own, and the irreversible bits. Every control here applies at once.
 * The sections are siblings with nothing wrapping them all in a `<section>`: the sandbox e2e finds
 * the Sandbox section as the one `<section>` that holds its heading.
 */
export function AdvancedTab({ detail, isPrimary, settings, reloadBot, onDeleted }: AdvancedTabProps) {
  const { name, title } = detail
  return (
    <>
      <ApprovalsSection name={name} title={title} isPrimary={isPrimary} approvals={settings.approvals} readError={settings.errors.approvals} reload={settings.reload} />
      <ComputerSection name={name} title={title} isPrimary={isPrimary} screen={settings.screen} readError={settings.errors.screen} reload={settings.reload} />
      <SandboxSection bot={name} title={title} />
      <HideSection detail={detail} reload={reloadBot} />
      {!isPrimary && <DangerZone name={name} title={title} onDeleted={onDeleted} />}
    </>
  )
}
