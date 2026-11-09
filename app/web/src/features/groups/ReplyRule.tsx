import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { GroupView, Routing } from '@/state/types'

import { memberTitle } from './group-titles'
import type { BotView } from '@/state/types'

const RULES: readonly { value: Routing; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto', hint: 'A quick check picks who answers' },
  { value: 'everyone', label: 'Everyone', hint: 'Every bot answers' },
  { value: 'lead', label: 'Lead', hint: 'A lead bot decides who answers' }
]

interface ReplyRuleProps {
  group: GroupView
  bots: readonly BotView[]
  routing: Routing
  lead: string
  onRouting: (routing: Routing) => void
  onLead: (memberId: string) => void
}

/** Who answers a message that mentions nobody. Lead needs a seated member. */
export function ReplyRule({ group, bots, routing, lead, onRouting, onLead }: ReplyRuleProps) {
  const items = group.members.map(m => ({ value: m.memberId, label: memberTitle(group, bots, m.memberId) }))
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="mb-1 text-sm font-medium">Who answers when nobody is @mentioned</legend>
      <div role="radiogroup" aria-label="Who answers when nobody is @mentioned" className="flex flex-col gap-1.5">
        {RULES.map(rule => (
          <label key={rule.value} className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="radio" name="group-routing" value={rule.value} checked={routing === rule.value} onChange={() => onRouting(rule.value)} className="mt-1 accent-foreground" />
            <span className="flex flex-col">
              <span className="font-medium">{rule.label}</span>
              <span className="text-xs text-muted-foreground">{rule.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {routing === 'lead' && (
        <Select value={lead || null} onValueChange={v => v !== null && onLead(String(v))} items={items}>
          <SelectTrigger aria-label="Lead bot" className="w-full">
            <SelectValue placeholder="Choose a lead" />
          </SelectTrigger>
          <SelectContent>
            {items.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      <p className="text-xs text-muted-foreground">@mentions always go straight to the bots you name.</p>
    </fieldset>
  )
}
