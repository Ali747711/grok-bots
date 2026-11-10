import { useEffect, useRef } from 'react'

import { Button } from '@/components/ui/button'

import { PULL_ERROR_TEXT, progressText } from './sandbox-api'
import { useImageStatus } from './use-sandbox'

/** Download the sandbox image once. Calls `onReady` when it turns present. */
export function ImageDownload({ onReady }: { onReady: () => void }) {
  const { status, start, starting, failure } = useImageStatus()
  const told = useRef(false)
  const present = status?.present === true
  useEffect(() => {
    if (present && !told.current) {
      told.current = true
      onReady()
    }
  }, [present, onReady])
  const pulling = status?.pulling === true
  const error = status?.error ?? null
  return (
    <div className="flex flex-col gap-2 text-sm">
      <Button type="button" size="sm" className="self-start" disabled={starting || pulling} onClick={() => void start()}>
        {error ? 'Download again' : 'Download (about 1.2 GB)'}
      </Button>
      {pulling && (
        <>
          <progress aria-label="Download progress" className="h-2 w-full accent-primary" max={100} {...(progressValue(status?.progress ?? null))} />
          <span className="text-muted-foreground">{progressText(status?.progress ?? null)}</span>
        </>
      )}
      {failure && <span data-testid="image-failure" className="text-destructive">{failure}</span>}
      {!pulling && error && <span className="text-destructive">{PULL_ERROR_TEXT[error]}</span>}
    </div>
  )
}

/** A determinate bar when the size is known, else the browser's busy bar. */
function progressValue(p: { bytesDone: number | null; bytesTotal: number | null; layersDone: number; layersTotal: number } | null) {
  if (!p) return {}
  if (p.bytesDone !== null && p.bytesTotal) return { value: Math.round((p.bytesDone / p.bytesTotal) * 100) }
  if (p.layersTotal > 0) return { value: Math.round((p.layersDone / p.layersTotal) * 100) }
  return {}
}
