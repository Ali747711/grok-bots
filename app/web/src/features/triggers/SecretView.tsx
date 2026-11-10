import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { DialogTitle } from '@/components/ui/dialog'

import { curlExample, GENERIC_HELP, githubSteps } from './setup-help'
import type { TriggerSource } from './types'

interface SecretViewProps {
  source: TriggerSource
  url: string
  secret: string
  events: readonly string[]
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success('Copied')
  } catch {
    toast.error("Couldn't copy. Select the text and copy it.")
  }
}

function CopyRow({ label, value, button }: { label: string; value: string; button: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="px-1 text-xs font-medium text-muted-foreground">{label}</div>
      <div className="flex items-start gap-2">
        <code className="min-w-0 flex-1 rounded-xl bg-raised px-3 py-2 font-mono text-xs break-all">{value}</code>
        <Button type="button" size="sm" variant="outline" onClick={() => void copy(value)}>{button}</Button>
      </div>
    </div>
  )
}

/** Shown once after Create: the only place the secret ever appears. Nothing here keeps it. */
export function SecretView({ source, url, secret, events }: SecretViewProps) {
  const example = curlExample(url, secret, events[0] ?? 'test')
  return (
    <div className="flex flex-col gap-3">
      <DialogTitle>Trigger ready</DialogTitle>
      <CopyRow label="URL" value={url} button="Copy URL" />
      <CopyRow label="Secret" value={secret} button="Copy secret" />
      <p className="text-[13px] font-semibold">The secret is shown once.</p>
      <p className="text-xs font-medium text-muted-foreground">Reachable from this computer and your Mac tunnel; public access comes later.</p>
      {source === 'github' ? (
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-[13px] font-medium">
          {githubSteps(events).map(step => <li key={step}>{step}</li>)}
        </ol>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-medium">{GENERIC_HELP}</p>
          <pre data-testid="curl-example" className="scroll-thin overflow-x-auto rounded-xl bg-raised px-3 py-2 font-mono text-xs">{example}</pre>
          <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => void copy(example)}>Copy example</Button>
        </div>
      )}
    </div>
  )
}
