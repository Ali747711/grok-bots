import { useEffect, useId, useState } from 'react'

import { Switch } from '@/components/ui/switch'
import { getScreenConfig, setUseScreen } from '@/lib/crew-api'

interface UseScreenSwitchProps {
  readonly name: string
  readonly title: string
}

/**
 * Lets the bot use its screen on its own (headed browser + auto start, written together by the
 * server). Not offered for the primary bot: new bots clone its config, so turning it on there would
 * make every later bot headed (§11 R8). On only when both keys are true.
 */
export function UseScreenSwitch({ name, title }: UseScreenSwitchProps) {
  const [on, setOn] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const labelId = useId()

  useEffect(() => {
    let current = true
    setOn(null)
    setError(null)
    getScreenConfig(name).then(
      config => current && setOn(config.useScreen),
      (e: unknown) => current && setError(e instanceof Error ? e.message : 'Could not read the setting')
    )
    return () => {
      current = false
    }
  }, [name])

  const change = async (next: boolean): Promise<void> => {
    setError(null)
    try {
      setOn((await setUseScreen(name, next)).useScreen)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    }
  }

  return (
    <div className="flex items-start gap-3 border-t border-border pt-3">
      <Switch aria-labelledby={labelId} checked={on === true} disabled={on === null} onCheckedChange={v => void change(v)} />
      <div className="flex flex-col gap-0.5 text-sm">
        <span id={labelId} className="font-medium">Let {title} use its screen</span>
        <span className="text-xs text-muted-foreground">Takes effect the next time {title} opens its browser.</span>
        {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
      </div>
    </div>
  )
}
