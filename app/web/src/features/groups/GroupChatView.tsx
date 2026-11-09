import type { GroupView } from '@/state/types'

/** The open group's chat. Task 7 adds the transcript and composer; for now only the header. */
export function GroupChatView({ group }: { group: GroupView }) {
  return (
    <header className="flex items-center gap-3 border-b border-border px-5 py-3">
      <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{group.name}</h2>
    </header>
  )
}
