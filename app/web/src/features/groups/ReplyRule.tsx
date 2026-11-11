import { useId } from 'react'

import { Section } from '@/components/console/fields'
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

interface RuleListProps {
  /** Accessible name of the radio group. */
  label: string
  routing: Routing
  onRouting: (routing: Routing) => void
}

/**
 * The three rules in the console option-list look (the chosen row lifts out of the well). The real radio
 * covers its whole row instead of being hidden off-screen, so a click on the radio itself lands on it.
 */
function RuleList({ label, routing, onRouting }: RuleListProps) {
  const name = useId()
  return (
    <fieldset role="radiogroup" aria-label={label} className="m-0 flex min-w-0 flex-col gap-0.5 rounded-[22px] border-0 bg-background p-1">
      {RULES.map(rule => (
        <label key={rule.value} className="group relative flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-shell has-checked:bg-shell has-focus-visible:ring-3 has-focus-visible:ring-ring">
          <input type="radio" name={name} value={rule.value} checked={routing === rule.value} onChange={() => onRouting(rule.value)} className="absolute inset-0 m-0 size-full cursor-pointer opacity-0" />
          <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px] border-control transition-colors group-has-checked:border-foreground">
            <span className="size-2 rounded-full bg-foreground opacity-0 transition-opacity group-has-checked:opacity-100" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold">{rule.label}</span>
            <span className="block text-xs font-medium text-faint">{rule.hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  )
}

/** Who answers a message that mentions nobody. Lead needs a seated member. */
export function ReplyRule({ group, bots, routing, lead, onRouting, onLead }: ReplyRuleProps) {
  const items = group.members.map(m => ({ value: m.memberId, label: memberTitle(group, bots, m.memberId) }))
  return (
    <Section title={TITLE} hint="@mentions always go straight to the bots you name.">
      <RuleList label={TITLE} routing={routing} onRouting={onRouting} />
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
