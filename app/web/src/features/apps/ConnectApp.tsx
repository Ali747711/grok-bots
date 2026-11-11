import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { ERROR_TEXT, FIELD, FIELD_LABEL, WELL } from '@/components/console/dialog-styles'
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
      <div className={`${WELL} flex flex-col gap-1.5 p-4 text-[13px] font-medium`} role="status">
        <span className="font-semibold">Waiting for sign-in…</span>
        {sign.app && <span className="text-muted-foreground">Finish signing in to {sign.app.name} in the new tab.</span>}
        {sign.url && (
          <a href={sign.url} target="_blank" rel="noopener noreferrer" className="w-fit rounded-full underline underline-offset-2 outline-none focus-visible:ring-3 focus-visible:ring-ring">Open the sign-in page</a>
        )}
      </div>
    )
  }
  if (sign.state === 'failed') {
    return (
      <div className={`${WELL} flex flex-col gap-3 p-4`}>
        <p role="alert" className="text-[13px] font-medium text-destructive">{sign.failure ?? "Sign-in didn't finish"}</p>
        <Button type="button" size="sm" variant="outline" className="self-start" onClick={sign.reset}>Try again</Button>
      </div>
    )
  }
  return (
    <div className={FIELD}>
      <label htmlFor="apps-search" className={FIELD_LABEL}>Search apps</label>
      <Input id="apps-search" value={query} onChange={e => setQuery(e.target.value)} />
      {error && <p role="alert" className={ERROR_TEXT}>{error}</p>}
      <ul className="m-0 flex max-h-60 list-none scroll-thin flex-col gap-1 overflow-y-auto p-0 empty:hidden">
        {results.map(t => (
          <li key={t.slug} className="flex min-h-12 items-center gap-2.5 rounded-3xl bg-background py-1.5 pr-1.5 pl-2">
            <AppTile name={t.name} />
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{t.name}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void sign.start(t)}>Connect</Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
