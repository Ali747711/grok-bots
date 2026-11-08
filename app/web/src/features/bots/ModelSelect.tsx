import { useEffect, useState } from 'react'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { crewFetch } from '@/lib/crew-api'

import type { ModelChoice } from './types'

interface ModelOptions {
  readonly provider: string
  readonly model: string
  readonly models: readonly string[]
}

interface ModelSelectProps {
  /** The chosen model, or null for the default. */
  value: ModelChoice | null
  onChange: (next: ModelChoice | null) => void
  /** Offer "Default (<model>)", which sends no model. */
  allowDefault?: boolean
  id?: string
}

interface RawOptions {
  providers?: readonly { slug?: string; is_current?: boolean; models?: readonly string[] }[]
  model?: string
  provider?: string
}

async function loadOptions(): Promise<ModelOptions | null> {
  try {
    const res = await crewFetch('/api/model/options')
    if (!res.ok) return null
    const raw = (await res.json()) as RawOptions
    const current = raw.providers?.find(p => p.is_current)
    if (!current?.slug) return null
    return { provider: current.slug, model: raw.model ?? '', models: current.models ?? [] }
  } catch {
    return null
  }
}

/** Stands for "no model chosen": Base UI treats an empty string as no selection. */
const DEFAULT = '__default__'

/** Models of the current provider (read from Hermes), plus the default. The label is the element with id `${id}-label`. */
export function ModelSelect({ value, onChange, allowDefault = true, id = 'bot-model' }: ModelSelectProps) {
  const [options, setOptions] = useState<ModelOptions | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    void loadOptions().then(next => {
      if (!active) return
      setOptions(next)
      setFailed(next === null)
    })
    return () => {
      active = false
    }
  }, [])

  const models = options?.models ?? []
  const chosen = value && models.includes(value.model) ? value.model : DEFAULT
  const pick = (model: string) => onChange(model === DEFAULT || !options ? null : { provider: options.provider, model })
  const items = [
    ...(allowDefault ? [{ value: DEFAULT, label: options?.model ? `Default (${options.model})` : 'Default' }] : []),
    ...models.map(m => ({ value: m, label: m }))
  ]

  return (
    <div className="flex flex-col gap-1">
      <Select value={chosen} onValueChange={v => v !== null && pick(v)} items={items}>
        <SelectTrigger id={id} aria-labelledby={`${id}-label`} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {failed && <p className="text-xs text-muted-foreground">Couldn't load models</p>}
    </div>
  )
}
