import { useState } from 'react'

import { type Option, OptionList, Section } from '@/components/console/fields'
import { Button } from '@/components/ui/button'

import { type ApprovalMode, type ApprovalsView, setApprovals } from './profile-api'
import { Note, PrimaryReason, ReadError, RowError } from './RowNotes'
import { useProfileRowAction } from './use-profile-row-action'

interface ApprovalsSectionProps {
  name: string
  title: string
  isPrimary: boolean
  /** The mode in effect; null until it has been read. */
  approvals: ApprovalsView | null
  /** Why it could not be read. */
  readError: string | null
  reload: () => Promise<void>
}

// Copy from docs/ui2/hermes-facts.md Q4 (PF26): what each mode really does.
const OPTIONS: Option<ApprovalMode>[] = [
  { value: 'manual', label: 'Ask before risky commands', description: 'Hermes stops and asks you before each command it flags as risky.' },
  {
    value: 'smart',
    label: 'Let a checker model decide first',
    description: 'A model may approve risky commands without asking you; when it refuses, you still decide (Allow once / Deny). Each check costs a model call.'
  },
  { value: 'off', label: 'Never ask', description: 'Risky commands run without asking you.' }
]

interface ConfirmOffProps {
  title: string
  onConfirm: () => void
  onCancel: () => void
}

/** "Never ask" is never one click: it also drops the bot's apps to Read only (Crew's `level_unavailable` rule). */
function ConfirmOff({ title, onConfirm, onCancel }: ConfirmOffProps) {
  return (
    <div role="group" aria-label="Turn off approvals?" className="flex flex-col gap-2.5 rounded-2xl bg-shell p-3">
      <p className="text-[13px] font-medium">{`Risky commands will run without asking you, and ${title}'s apps drop to Read only.`}</p>
      <div className="flex gap-1.5">
        <Button type="button" size="sm" variant="destructive" onClick={onConfirm}>Turn off approvals</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

/**
 * When the bot must stop and ask (`approvals.mode`). It shows the mode in effect, so an unset key
 * reads as Hermes's default. A choice applies at once, except "Never ask", which asks first.
 * Read-only for the primary bot: new bots copy its config.
 */
export function ApprovalsSection({ name, title, isPrimary, approvals, readError, reload }: ApprovalsSectionProps) {
  const [confirming, setConfirming] = useState(false)
  const { pending, error, run } = useProfileRowAction({ title, reload })
  const locked = isPrimary || pending || approvals === null

  const choose = (mode: ApprovalMode) => {
    if (locked || mode === approvals.mode) return
    if (mode === 'off') setConfirming(true)
    else {
      setConfirming(false)
      void run(() => setApprovals(name, mode))
    }
  }
  const turnOff = () => {
    setConfirming(false)
    void run(() => setApprovals(name, 'off'))
  }

  return (
    <Section title="Approvals" hint={`When ${title} must stop and ask you first.${approvals?.isDefault ? " This is Hermes's default." : ''}`}>
      <OptionList legend="Approvals" value={approvals?.mode ?? null} options={OPTIONS} onChange={choose} disabled={locked} />
      {confirming && !locked && <ConfirmOff title={title} onConfirm={turnOff} onCancel={() => setConfirming(false)} />}
      {error && <RowError>{error}</RowError>}
      {approvals === null && readError && <ReadError reason={readError} />}
      {isPrimary && <PrimaryReason title={title} />}
      <Note>Applies from the next risky command.</Note>
      <Note>App actions ask through their own prompt, whichever you pick here.</Note>
      {approvals?.sandboxed && (
        <Note>{`Inside the sandbox, ${title} runs commands and code without asking you. Hermes treats the sandbox as the safety boundary. Commands you've blocked in Hermes are still refused.`}</Note>
      )}
    </Section>
  )
}
