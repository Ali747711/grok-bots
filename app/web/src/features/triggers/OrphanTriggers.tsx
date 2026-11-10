import { Badge } from '@/components/ui/badge'

import { TriggerItem } from './TriggerItem'
import type { TriggerView } from './types'

/** Triggers whose routine was deleted: they cannot fire, but they can still be switched or removed. */
export function OrphanTriggers({ triggers, onChanged }: { bot: string; triggers: readonly TriggerView[]; onChanged: () => void }) {
  if (triggers.length === 0) return null
  return (
    <section className="flex flex-col gap-1.5 rounded-2xl bg-muted p-3">
      <h3 className="label-mono">Triggers of deleted routines</h3>
      <ul className="flex flex-col gap-1">
        {triggers.map(t => (
          <li key={t.id} className="flex list-none flex-col gap-1">
            <TriggerItem trigger={t} routine={null} onChanged={onChanged} />
            <Badge variant="outline" className="h-5 self-start px-2 text-xs text-warn-ink">Routine missing</Badge>
          </li>
        ))}
      </ul>
    </section>
  )
}
