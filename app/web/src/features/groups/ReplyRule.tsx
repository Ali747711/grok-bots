import { Section } from '@/components/console/fields'
import { RadioRows } from '@/components/console/radio-rows'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { BotView, GroupView, Routing } from '@/state/types'

import { memberTitle } from './group-titles'

const RULES: readonly { value: Routing; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto', hint: 'A quick check picks who answers' },
  { value: 'everyone', label: 'Everyone', hint: 'Every bot answers' },
  { value: 'lead', label: 'Lead', hint: 'A lead bot decides who answers' }
]

const TITLE = 'Who answers when nobody is @mentioned'

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
    <Section title={TITLE} hint="@mentions always go straight to the bots you name.">
      <RadioRows legend={TITLE} showLegend={false} value={routing} options={RULES} onChange={onRouting} />
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
    </Section>
  )
}
