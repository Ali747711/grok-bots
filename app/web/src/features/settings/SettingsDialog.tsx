import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { creditText, type Usage } from '@/features/usage/CreditPill'

import { ComposioKeyRow } from './ComposioKeyRow'
import { saveSettings } from './settings-api'

const LIMITS: readonly number[] = [1, 2, 3, 4, 6, 8, 12]
const NO_LIMIT = 'none'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Current limit from the live state; null means no limit. */
  maxWorkingBots: number | null
  /** Credit from the caller's single usage poll. */
  usage: Usage | null
}

const LABEL_ID = 'max-working-bots-label'

/** The options, plus a saved value outside the list (set by hand, 1-20 is valid) so the select can show it. */
function limitItems(saved: number | null): { value: string; label: string }[] {
  const numbers = saved !== null && !LIMITS.includes(saved) ? [...LIMITS, saved].sort((x, y) => x - y) : LIMITS
  return [...numbers.map(n => ({ value: String(n), label: String(n) })), { value: NO_LIMIT, label: 'No limit' }]
}

function LimitSelect({ value, onChange, saved }: { value: string; onChange: (v: string) => void; saved: number | null }) {
  const items = limitItems(saved)
  return (
    <Select value={value} onValueChange={v => v !== null && onChange(v)} items={items}>
      <SelectTrigger aria-labelledby={LABEL_ID} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

const toValue = (limit: number | null) => (limit === null ? NO_LIMIT : String(limit))

/** Crew settings: the working-bot limit. The state stream shows the saved value to every tab. */
export function SettingsDialog({ open, onOpenChange, maxWorkingBots, usage }: SettingsDialogProps) {
  const [value, setValue] = useState(toValue(maxWorkingBots))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      toast.success('Settings saved')
    } catch {
      setError('Could not save the settings. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>How many bots may work at once.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <span id={LABEL_ID} className="text-sm font-medium">Bots working at the same time</span>
          <LimitSelect value={value} onChange={setValue} saved={maxWorkingBots} />
          <p className="text-xs text-muted-foreground">Each working bot spends credit.</p>
          <p className="text-xs text-muted-foreground">{creditText(usage)}</p>
        </div>
        <ComposioKeyRow />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter showCloseButton>
          <Button onClick={() => void save()} disabled={saving}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
