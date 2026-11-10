import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { appsErrorText, searchToolkits } from './apps-api'
import type { Toolkit } from './apps-types'
import { AppTile } from './AppTile'
import { useSignIn } from './use-apps'

const DEBOUNCE_MS = 300

/** Debounced toolkit search; an empty query lists the popular ones. */
function useToolkitSearch(query: string) {
  const [results, setResults] = useState<readonly Toolkit[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      searchToolkits(query.trim())
        .then(r => { if (live) { setResults(r.toolkits); setError(null) } })
        .catch((e: unknown) => { if (live) setError(appsErrorText(e)) })
    }, DEBOUNCE_MS)
    return () => { live = false; clearTimeout(timer) }
  }, [query])
  return { results, error }
}

export function ConnectApp({ onConnected }: { onConnected: () => void }) {
  const [query, setQuery] = useState('')
  const { results, error } = useToolkitSearch(query)
  const sign = useSignIn()

  useEffect(() => {
    if (sign.state === 'connected' && sign.app) {
      toast.success(`${sign.app.name} connected`)
      onConnected()
      sign.reset()
    }
  }, [sign.state])

  if (sign.state === 'starting' || sign.state === 'waiting') {
    return (
      <div className="flex flex-col gap-2 text-sm" role="status">
        <span>Waiting for sign-in…</span>
        {sign.app && <span>Finish signing in to {sign.app.name} in the new tab.</span>}
        {sign.url && (
          <a href={sign.url} target="_blank" rel="noopener noreferrer" className="underline">Open the sign-in page</a>
        )}
      </div>
    )
  }
  if (sign.state === 'failed') {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p role="alert">{sign.failure ?? "Sign-in didn't finish"}</p>
        <Button type="button" size="sm" variant="outline" className="self-start" onClick={sign.reset}>Try again</Button>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="apps-search" className="text-sm font-medium">Search apps</label>
      <Input id="apps-search" value={query} onChange={e => setQuery(e.target.value)} />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto">
        {results.map(t => (
          <li key={t.slug} className="flex items-center gap-2">
            <AppTile name={t.name} />
            <span className="min-w-0 flex-1 truncate text-sm">{t.name}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void sign.start(t)}>Connect</Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
