import { useState } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'

import type { SandboxView } from './sandbox-types'

const NOTES = [
  "Commands, files, code and the bot's screen run inside an isolated container. It can't see your files, your keys or Crew.",
  'Browser tools are turned off in the sandbox. Hermes would run them outside the container, and on this computer the sandbox has no browser.',
  "Hermes doesn't ask before risky commands in the sandbox, because they can't touch your computer.",
  'Commands run as you, not as root, so the bot can\'t install system packages with apt. pip and npm installs into its own folders still work.',
  "Files in the bot's working folder are kept; anything else resets.",
  'An open chat switches when you reopen it.'
]

const groupsSentence = (title: string) =>
  `In these group chats ${title} keeps its old setup, because Hermes fixes it when a group starts. New groups use the sandbox.`

interface Props { title: string; groups: SandboxView['groups'] }

export function SandboxNotes({ title, groups }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-2 text-xs text-muted-foreground">
      <ul className="flex list-disc flex-col gap-1 pl-4">
        {NOTES.map(note => <li key={note}>{note}</li>)}
      </ul>
      {groups.length > 0 && (
        <Alert>
          <AlertDescription>
            {groupsSentence(title)}
            <ul className="mt-1 list-disc pl-4">
              {groups.map(g => <li key={g.id}>{g.name}</li>)}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      <button
        type="button" className="self-start underline underline-offset-2" aria-expanded={open} aria-controls="sandbox-outside"
        onClick={() => setOpen(o => !o)}
      >
        What stays outside
      </button>
      {open && (
        <div id="sandbox-outside" className="flex flex-col gap-1">
          <p>MCP servers and routine scripts run on your computer.</p>
          <p>{groupsSentence(title)}</p>
        </div>
      )}
    </div>
  )
}
