import { Alert, AlertDescription } from '@/components/ui/alert'
import type { BotAppsView } from '@/features/apps/apps-types'

const NOTES = [
  'Actions that change something ask you first in the chat.',
  'Routines can only use read-only app tools.',
  'Changes apply to new chats within a minute.'
]

const NOT_SANDBOXED =
  "This bot isn't sandboxed, so it can read files on this computer, including your Composio key. Turn on the sandbox for bots that use apps."
const NO_ASK = "This bot doesn't ask before actions, so it can only read in apps."
const GROUP = 'In group chats, app actions that change something are declined.'

interface Props { view: BotAppsView | null; sandboxed: boolean }

export function AppsNotes({ view, sandboxed }: Props) {
  return (
    <div className="flex flex-col gap-2 text-xs text-muted-foreground">
      {!sandboxed && <Alert role="note"><AlertDescription>{NOT_SANDBOXED}</AlertDescription></Alert>}
      <ul className="flex list-disc flex-col gap-1 pl-4">
        {NOTES.map(note => <li key={note}>{note}</li>)}
        {view && !view.asks && <li>{NO_ASK}</li>}
        {view?.roomWritesDeclined && <li>{GROUP}</li>}
      </ul>
    </div>
  )
}
