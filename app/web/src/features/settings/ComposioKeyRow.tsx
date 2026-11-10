import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { appsErrorText, getKey, removeKey, saveKey } from '@/features/apps/apps-api'
import { ConfirmAction } from '@/features/triggers/ConfirmAction'

const INPUT_ID = 'composio-key-input'

/** The Composio key. The key lives only in the input, which is cleared after every attempt. */
export function ComposioKeyRow() {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const read = useCallback(async () => {
    try {
      const res = await getKey()
      if (alive.current) setConfigured(res.configured)
    } catch {
      // The status stays unknown; Save still works.
    }
  }, [])
  useEffect(() => { void read() }, [read])

  const save = async () => {
    const key = value.trim()
    if (key === '') return
    setBusy(true)
    setError(null)
    try {
      await saveKey(key)
      toast.success('Key saved')
    } catch (e) {
      if (alive.current) setError(appsErrorText(e))
    }
    if (!alive.current) return
    setValue('')
    await read()
    setBusy(false)
  }

  const remove = async () => {
    setBusy(true)
    setError(null)
    try {
      await removeKey()
      toast.success('Key removed')
    } catch (e) {
      if (alive.current) setError(appsErrorText(e))
    }
    if (!alive.current) return
    setConfirming(false)
    await read()
    setBusy(false)
  }

  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Apps (Composio)</h3>
        {configured !== null && <span className="text-xs text-muted-foreground">{configured ? 'Saved' : 'Not set'}</span>}
      </div>
      <label htmlFor={INPUT_ID} className="text-xs text-muted-foreground">Composio API key</label>
      <Input
        id={INPUT_ID} type="password" autoComplete="off" value={value} disabled={busy}
        onChange={e => setValue(e.target.value)}
      />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={busy || value.trim() === ''} onClick={() => void save()}>Save key</Button>
        {configured === true && (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setConfirming(true)}>Remove key</Button>
        )}
      </div>
      <ConfirmAction
        open={confirming} onOpenChange={setConfirming} busy={busy} confirm="Remove key" destructive
        title="Remove the Composio key?"
        description="Bots keep their app settings but lose their app tools until you save a key again."
        onConfirm={() => void remove()}
      />
    </section>
  )
}
