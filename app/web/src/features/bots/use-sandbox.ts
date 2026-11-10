import { useCallback, useEffect, useRef, useState } from 'react'

import { checkReason, getImage, getSandbox, pullImage, sandboxErrorText } from './sandbox-api'
import type { ImageStatus, SandboxView } from './sandbox-types'

/** The bot's sandbox as Hermes holds it. `error` is the reason it couldn't be checked. */
export function useSandbox(bot: string) {
  const [view, setView] = useState<SandboxView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  const reload = useCallback(async () => {
    try {
      const next = await getSandbox(bot)
      if (!alive.current) return
      setView(next)
      setError(null)
    } catch (e) {
      if (alive.current) setError(checkReason(e))
    }
  }, [bot])
  useEffect(() => { void reload() }, [reload])
  return { view, error, reload }
}

const POLL_MS = 1000

/** The shared image download. Polls once a second while a pull runs. */
export function useImageStatus() {
  const [status, setStatus] = useState<ImageStatus | null>(null)
  const [starting, setStarting] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const busy = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  const read = useCallback(async (fetcher: () => Promise<ImageStatus>) => {
    try {
      const next = await fetcher()
      if (!alive.current) return
      setStatus(next)
      setFailure(null)
    } catch (e) {
      // Keep the last status: the next poll or click tries again.
      if (alive.current) setFailure(sandboxErrorText(e))
    }
  }, [])
  useEffect(() => { void read(getImage) }, [read])
  const pulling = status?.pulling === true
  useEffect(() => {
    if (!pulling) return undefined
    const id = setInterval(() => void read(getImage), POLL_MS)
    return () => clearInterval(id)
  }, [pulling, read])
  const start = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    setStarting(true)
    try {
      await read(pullImage)
    } finally {
      busy.current = false
      if (alive.current) setStarting(false)
    }
  }, [read])
  return { status, start, starting, failure }
}
