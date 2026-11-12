import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { DIALOG_DESCRIPTION, DIALOG_TITLE, ERROR_TEXT, FIELD, FIELD_LABEL, HINT } from '@/components/console/dialog-styles'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { creditText, type Usage } from '@/features/usage/CreditPill'
import type { CrewSettings } from '@/state/types'

import { ComposioKeyRow } from './ComposioKeyRow'
import { browserTimeZone, saveSettings } from './settings-api'

const LIMITS: readonly number[] = [1, 2, 3, 4, 6, 8, 12]
const NO_LIMIT = 'none'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The live settings: the limit (null means no limit), the owner's name and time zone. */
  settings: CrewSettings
  /** Credit from the caller's single usage poll. */
  usage: Usage | null
}

const LABEL_ID = 'max-working-bots-label'
const NAME_ID = 'owner-name'
const OWNER_NAME_MAX = 60

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

/** The body of a save: the time zone goes only on the first save, while none is stored. */
function settingsPatch(settings: CrewSettings, limit: string, name: string): Partial<CrewSettings> {
  return {
    maxWorkingBots: limit === NO_LIMIT ? null : Number(limit),
    ownerName: name.trim() || null,
    ...(settings.timeZone ? {} : { timeZone: browserTimeZone() })
  }
}

/** Crew settings: the owner's name and the working-bot limit. The state stream shows saved values to every tab. */
export function SettingsDialog({ open, onOpenChange, settings, usage }: SettingsDialogProps) {
  const { maxWorkingBots } = settings
  const [value, setValue] = useState(toValue(maxWorkingBots))
  const [name, setName] = useState(settings.ownerName ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Start from the saved value each time the dialog opens.
  useEffect(() => {
    if (open) {
      setValue(toValue(maxWorkingBots))
      setName(settings.ownerName ?? '')
      setError(null)
    }
  }, [open, maxWorkingBots, settings.ownerName])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await saveSettings(settingsPatch(settings, value, name))
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
      <DialogContent className="max-h-[85vh] gap-5 overflow-y-auto">
        <DialogHeader>
          <DialogTitle className={DIALOG_TITLE}>Settings</DialogTitle>
          <DialogDescription className={DIALOG_DESCRIPTION}>Your name and how many bots may work at once.</DialogDescription>
        </DialogHeader>
        <div className={FIELD}>
          <label htmlFor={NAME_ID} className={FIELD_LABEL}>Your name</label>
          <Input id={NAME_ID} value={name} maxLength={OWNER_NAME_MAX} autoComplete="off" onChange={e => setName(e.target.value)} />
          <p className={HINT}>{`Your bots call you this and use your time zone (${settings.timeZone ?? browserTimeZone() ?? 'not set'}).`}</p>
        </div>
        <div className={FIELD}>
          <span id={LABEL_ID} className={FIELD_LABEL}>Bots working at the same time</span>
          <LimitSelect value={value} onChange={setValue} saved={maxWorkingBots} />
          <div className="flex flex-col gap-1">
            <p className={HINT}>Each working bot spends credit.</p>
            {/* The balance is private: the visual check masks it, like the credit pill. */}
            <p data-private="credit" className={HINT}>{creditText(usage)}</p>
          </div>
        </div>
        <ComposioKeyRow />
        {error && <p role="alert" className={ERROR_TEXT}>{error}</p>}
        <DialogFooter showCloseButton>
          <Button onClick={() => void save()} disabled={saving}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
