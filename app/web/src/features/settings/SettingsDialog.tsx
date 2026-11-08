import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { creditText, useUsage } from '@/features/usage/CreditPill'

import { saveSettings } from './settings-api'

const LIMITS: readonly number[] = [1, 2, 3, 4, 6, 8, 12]
const NO_LIMIT = 'none'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Current limit from the live state; null means no limit. */
  maxWorkingBots: number | null
}

const toValue = (limit: number | null) => (limit === null ? NO_LIMIT : String(limit))

/** Crew settings: the working-bot limit. The state stream shows the saved value to every tab. */
export function SettingsDialog({ open, onOpenChange, maxWorkingBots }: SettingsDialogProps) {
  const [value, setValue] = useState(toValue(maxWorkingBots))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const usage = useUsage()

  // Start from the saved value each time the dialog opens.
  useEffect(() => {
    if (open) {
      setValue(toValue(maxWorkingBots))
      setError(null)
    }
  }, [open, maxWorkingBots])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await saveSettings({ maxWorkingBots: value === NO_LIMIT ? null : Number(value) })
      onOpenChange(false)
    } catch {
      setError('Could not save the settings. Try again.')
    } finally {
      setSaving(false)
    }
  }

  // A saved value outside the list (set by hand, 1-20 is valid) still needs an option so the select shows it.
  const options =
    maxWorkingBots !== null && !LIMITS.includes(maxWorkingBots) ? [...LIMITS, maxWorkingBots].sort((a, b) => a - b) : LIMITS

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>How many bots may work at once.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="max-working-bots" className="text-sm font-medium">Bots working at the same time</label>
          <select
            id="max-working-bots"
            value={value}
            onChange={e => setValue(e.target.value)}
            className="h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {options.map(n => <option key={n} value={String(n)}>{n}</option>)}
            <option value={NO_LIMIT}>No limit</option>
          </select>
          <p className="text-xs text-muted-foreground">Each working bot spends credit.</p>
          <p className="text-xs text-muted-foreground">{creditText(usage)}</p>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter showCloseButton>
          <Button onClick={() => void save()} disabled={saving}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
