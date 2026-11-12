import { useState } from 'react'
import { toast } from 'sonner'

import { Section, Switch } from '@/components/console/fields'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { RowError } from '@/features/profile/RowNotes'

import { ImageDownload } from './ImageDownload'
import { ResetSandbox } from './ResetSandbox'
import { sandboxErrorText, setSandbox } from './sandbox-api'
import { SandboxNotes } from './SandboxNotes'
import { DEFAULT_IMAGE, type SandboxView } from './sandbox-types'
import { useSandbox } from './use-sandbox'

/** The one-line state of the sandbox, in the order the plan fixes. */
function StatusLine({ view, error, onReady }: {
  view: SandboxView | null; error: string | null; onReady: () => void
}) {
  let line: React.ReactNode = null
  if (error) line = `Couldn't check the sandbox: ${error}`
  else if (view) {
    if (view.docker !== 'ok') line = "Docker isn't available on this computer"
    else if (!view.imagePresent) {
      line = (
        <div className="flex flex-col gap-2">
          <span>The sandbox image isn&apos;t downloaded</span>
          {view.image === DEFAULT_IMAGE
            ? <ImageDownload onReady={onReady} />
            : <span>This bot uses its own image, {view.image}. Download it with Docker.</span>}
        </div>
      )
    } else if (view.container?.running) line = view.container.memMb !== null ? `Running · ${view.container.memMb} MB` : 'Running'
    else line = 'Sandbox ready'
  }
  return <div role="status" className="text-xs font-medium text-faint">{line}</div>
}

export function SandboxSection({ bot, title }: { bot: string; title: string }) {
  const { view, error, reload } = useSandbox(bot)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const on = view !== null && view.state !== 'off'
  const canTurnOn = view?.docker === 'ok' && view.imagePresent
  const toggle = async (next: boolean) => {
    setBusy(true)
    setFailure(null)
    try {
      await setSandbox(bot, next)
      toast.success(next ? 'Sandbox on' : 'Sandbox off')
    } catch (e) {
      setFailure(sandboxErrorText(e))
    }
    // Always re-read: the config may be written even when the answer was a failure.
    await reload()
    setBusy(false)
  }
  const label = `Run ${title}'s tools in a sandbox`
  return (
    <Section title="Sandbox" hint={`Where ${title}'s commands, files and code run.`}>
      <div className="flex items-center justify-between gap-3 rounded-2xl px-3 py-2.5">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-[13px] font-semibold">{label}</p>
          <StatusLine view={view} error={error} onReady={() => void reload()} />
        </div>
        <Switch label={label} checked={on} disabled={busy || view === null || (!on && !canTurnOn)} onChange={next => void toggle(next)} />
      </div>
      {failure && <RowError>{failure}</RowError>}
      {view?.state === 'partial' && (
        <Alert>
          <AlertDescription>
            Some settings reach outside the sandbox:
            <ul className="mt-1 flex list-none flex-col gap-0.5">{view.reasons.map(r => <li key={r}>{r}</li>)}</ul>
          </AlertDescription>
        </Alert>
      )}
      {view && <SandboxNotes title={title} groups={view.groups ?? []} />}
      {view?.container != null && <ResetSandbox bot={bot} title={title} onDone={() => void reload()} />}
    </Section>
  )
}
