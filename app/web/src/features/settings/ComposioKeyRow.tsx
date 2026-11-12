import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { ERROR_TEXT, HINT } from '@/components/console/dialog-styles'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { codeOf, getKey, removeKey, saveKey } from '@/features/apps/apps-api'
import { notifyKeyChanged } from '@/features/apps/open-dialog'
import { CrewApiError } from '@/lib/crew-json'
import { StatusPill } from '@/components/console/status-pill'
import { ConfirmAction } from '@/features/triggers/ConfirmAction'

const INPUT_ID = 'composio-key-input'

/** Why saving the key failed. */
function saveErrorText(e: unknown): string {
  const code = codeOf(e)
  if (code === 'bad_body') return "That doesn't look like a Composio key."
  if (code === 'key_rejected') return 'Key not accepted'
  if (e instanceof CrewApiError && e.status === 503) return 'Hermes is offline'
  return "Couldn't save the key. Try again."
}

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
      notifyKeyChanged()
    } catch (e) {
      if (alive.current) setError(saveErrorText(e))
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
      notifyKeyChanged()
    } catch {
      if (alive.current) setError("Couldn't remove the key. Try again.")
    }
    if (!alive.current) return
    setConfirming(false)
    await read()
    setBusy(false)
  }

  return (
    // `data-private` covers the whole row: the visual check masks it, so no shot shows the field or whether a key is saved.
    <section data-private="composio-key" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <h3 className="text-[13px] font-semibold">Apps (Composio)</h3>
        {configured !== null && <StatusPill tone={configured ? 'ok' : 'quiet'}>{configured ? 'Saved' : 'Not set'}</StatusPill>}
      </div>
      <label htmlFor={INPUT_ID} className={HINT}>Composio API key</label>
      <Input
        id={INPUT_ID} type="password" autoComplete="off" value={value} disabled={busy}
        onChange={e => setValue(e.target.value)}
      />
      {error && <p role="alert" className={ERROR_TEXT}>{error}</p>}
      <div className="flex gap-1.5">
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
