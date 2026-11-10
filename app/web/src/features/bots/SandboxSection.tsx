import { useState } from 'react'
import { toast } from 'sonner'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Switch } from '@/components/ui/switch'

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
            : <span className="text-muted-foreground">This bot uses its own image, {view.image}. Download it with Docker.</span>}
        </div>
      )
    } else if (view.container?.running) line = view.container.memMb !== null ? `Running · ${view.container.memMb} MB` : 'Running'
    else line = 'Sandbox ready'
  }
  return <div role="status" className="text-sm">{line}</div>
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
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Sandbox</h3>
      <StatusLine view={view} error={error} onReady={() => void reload()} />
      <div className="flex items-center justify-between text-sm">
        <span>Run {title}&apos;s tools in a sandbox</span>
        <Switch
          checked={on}
          disabled={busy || view === null || (!on && !canTurnOn)}
          onCheckedChange={next => void toggle(next)}
          aria-label={`Run ${title}'s tools in a sandbox`}
          className="data-checked:bg-foreground data-unchecked:border-muted-foreground"
        />
      </div>
      {failure && <p role="alert" className="text-sm text-destructive">{failure}</p>}
      {view?.state === 'partial' && (
        <Alert>
          <AlertDescription>
            Some settings reach outside the sandbox:
            <ul className="mt-1 list-disc pl-4">{view.reasons.map(r => <li key={r}>{r}</li>)}</ul>
          </AlertDescription>
        </Alert>
      )}
      {view && <SandboxNotes title={title} groups={view.groups ?? []} />}
      {view?.container != null && <ResetSandbox bot={bot} title={title} onDone={() => void reload()} />}
    </section>
  )
}
