import { useEffect, useState } from 'react'

/** `Date.now()`, refreshed every `intervalMs` so "asleep after 24 h" updates without a reload. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
