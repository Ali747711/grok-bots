import type { ReactNode } from 'react'

/** A row's failure, in the row. Red text is readable on the well, the shell and raised surfaces. */
export function RowError({ children }: { children: string }) {
  return <p role="alert" className="px-1 text-xs font-medium text-destructive">{children}</p>
}

/** A setting that could not be read: its controls stay off and this says why. */
export function ReadError({ reason }: { reason: string }) {
  return <RowError>{`Couldn't read this setting: ${reason}`}</RowError>
}

/** A plain note under a setting. */
export function Note({ children }: { children: ReactNode }) {
  return <p className="px-1 text-xs font-medium text-muted-foreground">{children}</p>
}

/** Why the primary bot's copy of a setting is read-only (spec §7.4). */
export function PrimaryReason({ title }: { title: string }) {
  return <Note>{`New bots copy ${title}'s settings, so change these in Hermes`}</Note>
}
