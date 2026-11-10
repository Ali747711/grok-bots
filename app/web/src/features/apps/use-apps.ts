import { useCallback, useEffect, useRef, useState } from 'react'

import { appsErrorText, codeOf, connect, listApps, pollConnect } from './apps-api'
import type { AppsList, Toolkit } from './apps-types'

/** The connected apps. `error` is a server code ('no_key', 'key_rejected') or a display text. */
export function useApps() {
  const [list, setList] = useState<AppsList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  const reload = useCallback(async () => {
    try {
      const next = await listApps()
      if (!alive.current) return
      setList(next)
      setError(null)
    } catch (e) {
      if (!alive.current) return
      const code = codeOf(e)
      setError(code === 'no_key' || code === 'key_rejected' ? code : appsErrorText(e))
    }
  }, [])
  useEffect(() => { void reload() }, [reload])
  return { list, error, reload }
}

const POLL_MS = 3000
const GIVE_UP_MS = 600_000

type Phase = 'idle' | 'starting' | 'waiting' | 'connected' | 'failed'

/** One sign-in: opens the tab, polls every 3 s, gives up after 10 minutes. Stops on unmount. */
export function useSignIn() {
  const [state, setState] = useState<Phase>('idle')
  const [url, setUrl] = useState<string | null>(null)
  const [app, setApp] = useState<Toolkit | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [id, setId] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const reset = useCallback(() => {
    setState('idle')
    setUrl(null)
    setApp(null)
    setId(null)
    setFailure(null)
  }, [])

  const start = useCallback(async (t: Toolkit) => {
    setApp(t)
    setFailure(null)
    setState('starting')
    try {
      const res = await connect(t.slug)
      if (!alive.current) return
      window.open(res.redirectUrl, '_blank', 'noopener,noreferrer')
      setUrl(res.redirectUrl)
      setId(res.connectionId)
      setState('waiting')
    } catch (e) {
      if (!alive.current) return
      setFailure(codeOf(e) === 'already_connected' ? 'Already connected' : appsErrorText(e))
      setState('failed')
    }
  }, [])

  useEffect(() => {
    if (state !== 'waiting' || id === null) return undefined
    const began = Date.now()
    let busy = false
    const timer = setInterval(() => {
      if (busy) return
      if (Date.now() - began >= GIVE_UP_MS) {
        setState('failed')
        return
      }
      busy = true
      pollConnect(id)
        .then(({ state: s }) => {
          if (!alive.current) return
          if (s === 'connected') setState('connected')
          else if (s === 'failed' || s === 'expired') setState('failed')
        })
        .catch(() => undefined) // a missed poll is retried on the next tick
        .finally(() => { busy = false })
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [state, id])

  return { state, url, app, failure, start, reset }
}
