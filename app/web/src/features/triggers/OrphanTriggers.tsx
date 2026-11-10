import { StatusPill } from '@/features/routines/StatusPill'

import { TriggerItem } from './TriggerItem'
import type { TriggerView } from './types'

/** Triggers whose routine was deleted: they cannot fire, but they can still be switched or removed. */
export function OrphanTriggers({ triggers, onChanged }: { bot: string; triggers: readonly TriggerView[]; onChanged: () => void }) {
  if (triggers.length === 0) return null
  return (
    <section className="flex flex-col gap-2 rounded-2xl bg-background p-2">
      <h3 className="px-1 pt-1 text-[13px] font-semibold">Triggers of deleted routines</h3>
      <ul className="flex flex-col gap-2">
        {triggers.map(t => (
          <li key={t.id} className="flex list-none flex-col gap-1.5">
            <TriggerItem trigger={t} routine={null} onChanged={onChanged} />
            <span className="px-1"><StatusPill tone="warn">Routine missing</StatusPill></span>
          </li>
        ))}
      </ul>
    </section>
  )
}
