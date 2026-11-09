import { MENTION_SCHEME } from '@/features/chat/Markdown'
import type { GroupMemberView } from '@/state/types'

import { findMentions } from './mentions'

const CODE = /(```[\s\S]*?```|`[^`\n]*`)/

/** Rewrite the mentions Hermes would route into marked links, leaving code spans and fences alone. */
export function markMentions(text: string, members: readonly GroupMemberView[]): string {
  return text
    .split(CODE)
    .map((part, i) => {
      if (i % 2 === 1) return part
      let out = ''
      let last = 0
      for (const m of findMentions(part, members)) {
        out += `${part.slice(last, m.start)}[${part.slice(m.start, m.end)}](${MENTION_SCHEME}x)`
        last = m.end
      }
      return out + part.slice(last)
    })
    .join('')
}
