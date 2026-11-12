import { Trash2 } from 'lucide-react'
import { useState } from 'react'

import { Section } from '@/components/console/fields'
import { Button } from '@/components/ui/button'
import { DeleteBotDialog } from '@/features/bots/DeleteBotDialog'

interface DangerZoneProps {
  name: string
  title: string
  onDeleted: () => void
}

/** Delete, behind Crew's typed-handle dialog. Never rendered for the primary bot. */
export function DangerZone({ name, title, onDeleted }: DangerZoneProps) {
  const [deleting, setDeleting] = useState(false)
  return (
    <Section title="Danger zone">
      <div className="flex items-center gap-3 rounded-3xl border border-border p-1.5 pr-2">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-raised text-muted-foreground">
          <Trash2 className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{`Delete ${title}`}</p>
          <p className="truncate text-xs font-medium text-faint">Removes its chats, routines, memory and files. This cannot be undone.</p>
        </div>
        <Button type="button" variant="destructive" onClick={() => setDeleting(true)}>Delete bot</Button>
      </div>
      <DeleteBotDialog name={name} title={title} open={deleting} onOpenChange={setDeleting} onDeleted={onDeleted} />
    </Section>
  )
}
