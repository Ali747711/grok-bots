import { useEffect, useState } from 'react'

import { Checkbox } from '@/components/ui/checkbox'

import { ImageDownload } from './ImageDownload'
import { useImageStatus } from './use-sandbox'

interface SandboxChoiceProps {
  checked: boolean
  onChange: (value: boolean) => void
  /** True when unticked, or ticked with Docker answering and the image downloaded. */
  onReadyChange: (ready: boolean) => void
}

/** "Run in a sandbox" for the New bot form, with the Docker and image state once ticked. */
export function SandboxChoice({ checked, onChange, onReadyChange }: SandboxChoiceProps) {
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={checked}
          onCheckedChange={onChange}
          aria-label="Run in a sandbox"
          className="border-muted-foreground data-checked:border-foreground data-checked:bg-foreground data-checked:text-background dark:data-checked:bg-foreground"
        />
        <span>Run in a sandbox</span>
      </label>
      {checked ? <SandboxState onReadyChange={onReadyChange} /> : <Idle onReadyChange={onReadyChange} />}
    </div>
  )
}

function Idle({ onReadyChange }: { onReadyChange: (ready: boolean) => void }) {
  useEffect(() => { onReadyChange(true) }, [onReadyChange])
  return null
}

/** Mounted only while ticked, so the image status is read only then. */
function SandboxState({ onReadyChange }: { onReadyChange: (ready: boolean) => void }) {
  const { status, failure } = useImageStatus()
  const docker = status?.docker
  // ImageDownload runs its own status hook; its onReady tells this one the download finished.
  const [downloaded, setDownloaded] = useState(false)
  const ready = docker === 'ok' && (status?.present === true || downloaded)
  useEffect(() => { onReadyChange(ready) }, [ready, onReadyChange])
  if (!status && failure) return <p role="alert" className="text-xs text-destructive">{failure}</p>
  if (!status || ready) return null
  if (docker !== 'ok') return <p className="text-xs text-muted-foreground">Docker isn&apos;t available on this computer</p>
  return (
    <div className="flex flex-col gap-2 text-xs">
      <span className="text-muted-foreground">The sandbox image isn&apos;t downloaded</span>
      <ImageDownload onReady={() => setDownloaded(true)} />
    </div>
  )
}
