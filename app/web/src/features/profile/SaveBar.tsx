import { Kbd } from '@/components/console/kbd'
import { Button } from '@/components/ui/button'
import { ConflictBanner } from '@/features/bots/ProfileNotices'
import type { Conflict } from '@/features/bots/use-profile-save'

import { RowError } from './RowNotes'

interface SaveBarProps {
  /** True when a text field (name, role, job, model, persona) differs from what is saved. */
  dirty: boolean
  /** A save is on its way, or an avatar write that Save must not race. */
  busy: boolean
  error: string | null
  conflict: Conflict | null
  onSave: () => void
  onDiscard: () => void
  onReload: () => void
  onSaveAnyway: () => void
}

/**
 * The one save bar for the profile's text fields, pinned to the bottom of the tab in view. It is
 * there only while something is unsaved; a conflict or a failed save shows above it.
 */
export function SaveBar({ dirty, busy, error, conflict, onSave, onDiscard, onReload, onSaveAnyway }: SaveBarProps) {
  if (!dirty && !error && !conflict) return null
  return (
    <div className="sticky bottom-0 z-10 mx-auto flex w-full max-w-2xl flex-col gap-2 px-5 pb-4">
      {conflict && <div className="rounded-2xl bg-shell shadow-panel"><ConflictBanner conflict={conflict} busy={busy} onReload={onReload} onSaveAnyway={onSaveAnyway} /></div>}
      {error && <div className="rounded-2xl bg-shell px-3 py-2.5 shadow-panel"><RowError>{error}</RowError></div>}
      {dirty && (
        <div role="group" aria-label="Unsaved changes" className="flex items-center gap-2 rounded-full bg-shell p-1.5 pl-4 shadow-panel">
          <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">Unsaved changes</p>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onDiscard}>Discard</Button>
          <Button type="button" size="sm" disabled={busy} onClick={onSave}>
            Save
            {/* Hidden from assistive tech: the button's name stays "Save". */}
            <span aria-hidden="true" className="ml-1 flex"><Kbd>⌘↵</Kbd></span>
          </Button>
        </div>
      )}
    </div>
  )
}
