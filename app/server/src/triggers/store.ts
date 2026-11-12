import { access, chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { z } from 'zod'

import { log } from '../log.js'
import {
  DELIVERY_IDS_MAX,
  EVENT_LOG_MAX,
  TRIGGER_OUTCOMES,
  TRIGGER_SOURCES,
  type EventPatch,
  type Trigger,
  type TriggerEvent,
  type TriggerPatch,
  type TriggerRun
} from './types.js'

const outcome = z.enum(TRIGGER_OUTCOMES)
const triggerSchema = z.object({
  id: z.string(), bot: z.string(), routineId: z.string(), name: z.string(),
  source: z.enum(TRIGGER_SOURCES), events: z.array(z.string()), actions: z.array(z.string()),
  enabled: z.boolean(), secret: z.string(), createdAt: z.number()
})
const eventSchema = z.object({
  id: z.string(), at: z.number(), deliveryId: z.string().nullable(), eventType: z.string(), action: z.string().nullable(),
  outcome, jobId: z.string().nullable(), runId: z.string().nullable(), endedAt: z.number().nullable(), detail: z.string().nullable()
})
const fileSchema = z.object({
  version: z.literal(1),
  triggers: z.array(triggerSchema),
  events: z.record(z.string(), z.array(eventSchema)),
  deliveries: z.record(z.string(), z.array(z.string()))
})

interface State {
  readonly triggers: readonly Trigger[]
  readonly events: Readonly<Record<string, readonly TriggerEvent[]>>
  readonly deliveries: Readonly<Record<string, readonly string[]>>
}

const EMPTY: State = { triggers: [], events: {}, deliveries: {} }

const HOUR_MS = 3_600_000

/**
 * Newest 50 events, plus older ones that must stay: `started` runs are still being watched (R7), and runs
 * of the last hour feed the hourly limit after a restart (at most 10 per trigger, given the limit).
 */
function trimLog(events: readonly TriggerEvent[], nowMs: number): readonly TriggerEvent[] {
  return events.filter((e, i) => i < EVENT_LOG_MAX || e.outcome === 'started' || (e.jobId !== null && nowMs - e.at < HOUR_MS))
}

/** A patch key set to `undefined` would be dropped by JSON and make the saved file unloadable. */
function defined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>
}

function withoutKey<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const { [key]: _drop, ...rest } = record
  return rest
}

/**
 * Trigger definitions, event logs and delivery ids in `<stateDir>/triggers.json` (0600, tmp + rename).
 * Mutations change memory at once and queue a write of the latest snapshot; their promise settles
 * when a write containing them finished.
 */
/** `<file>.corrupt-<ms>`, with the stamp moved on while that name is taken: two bad files in one millisecond must both be kept. */
async function asideName(file: string): Promise<string> {
  for (let stamp = Date.now(); ; stamp++) {
    const name = `${file}.corrupt-${stamp}`
    try {
      await access(name)
    } catch {
      return name
    }
  }
}

export class TriggerStore {
  private chain: Promise<unknown> = Promise.resolve()

  private constructor(
    private readonly file: string,
    private state: State
  ) {}

  static async load(file: string): Promise<TriggerStore> {
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new TriggerStore(file, EMPTY)
      throw error
    }
    let parsed: z.infer<typeof fileSchema> | undefined
    try {
      const result = fileSchema.safeParse(JSON.parse(raw))
      if (result.success) parsed = result.data
    } catch {
      // invalid JSON: handled below like a schema failure
    }
    if (!parsed) {
      await rename(file, await asideName(file))
      log.error('triggers file invalid, moved aside', { file })
      return new TriggerStore(file, EMPTY)
    }
    return new TriggerStore(file, { triggers: parsed.triggers, events: parsed.events, deliveries: parsed.deliveries })
  }

  all(): readonly Trigger[] {
    return this.state.triggers
  }

  forBot(bot: string): readonly Trigger[] {
    return this.state.triggers.filter(t => t.bot === bot)
  }

  get(id: string): Trigger | undefined {
    return this.state.triggers.find(t => t.id === id)
  }

  add(trigger: Trigger): Promise<void> {
    this.state = { ...this.state, triggers: [...this.state.triggers, trigger] }
    return this.queueWrite()
  }

  async update(id: string, patch: TriggerPatch): Promise<Trigger | undefined> {
    const current = this.get(id)
    if (!current) return undefined
    const next: Trigger = { ...current, ...defined(patch) }
    this.state = { ...this.state, triggers: this.state.triggers.map(t => (t.id === id ? next : t)) }
    await this.queueWrite()
    return next
  }

  async remove(id: string): Promise<boolean> {
    if (!this.get(id)) return false
    this.state = {
      triggers: this.state.triggers.filter(t => t.id !== id),
      events: withoutKey(this.state.events, id),
      deliveries: withoutKey(this.state.deliveries, id)
    }
    await this.queueWrite()
    return true
  }

  /** Newest first. */
  events(id: string): readonly TriggerEvent[] {
    return this.state.events[id] ?? []
  }

  lastEvent(id: string): TriggerEvent | null {
    return this.events(id)[0] ?? null
  }

  logEvent(id: string, event: TriggerEvent, deliveryId: string | null = null): Promise<void> {
    // A removed trigger (deleted while a run was in flight) must not leave events behind.
    if (!this.get(id)) return Promise.resolve()
    this.state = {
      ...this.state,
      events: { ...this.state.events, [id]: trimLog([event, ...this.events(id)], Date.now()) },
      deliveries: deliveryId ? this.withDelivery(id, deliveryId) : this.state.deliveries
    }
    return this.queueWrite()
  }

  async patchEvent(id: string, eventId: string, patch: EventPatch): Promise<TriggerEvent | undefined> {
    const current = this.events(id).find(e => e.id === eventId)
    if (!current) return undefined
    const next: TriggerEvent = { ...current, ...defined(patch) }
    this.state = { ...this.state, events: { ...this.state.events, [id]: this.events(id).map(e => (e.id === eventId ? next : e)) } }
    await this.queueWrite()
    return next
  }

  seenDelivery(id: string, deliveryId: string): boolean {
    return (this.state.deliveries[id] ?? []).includes(deliveryId)
  }

  recordDelivery(id: string, deliveryId: string): Promise<void> {
    if (!this.get(id)) return Promise.resolve()
    this.state = { ...this.state, deliveries: this.withDelivery(id, deliveryId) }
    return this.queueWrite()
  }

  /** Events that have a run id, for one routine's run list. */
  runsFor(bot: string, routineId: string): readonly TriggerRun[] {
    return this.forBot(bot)
      .filter(t => t.routineId === routineId)
      .flatMap(t => this.events(t.id).filter(e => e.runId !== null).map(event => ({ triggerId: t.id, triggerName: t.name, event })))
  }

  inFlight(): readonly { trigger: Trigger; event: TriggerEvent }[] {
    return this.state.triggers.flatMap(trigger => this.events(trigger.id).filter(e => e.outcome === 'started').map(event => ({ trigger, event })))
  }

  private withDelivery(id: string, deliveryId: string): Readonly<Record<string, readonly string[]>> {
    const ids = this.state.deliveries[id] ?? []
    const next = ids.includes(deliveryId) ? ids : [...ids, deliveryId].slice(-DELIVERY_IDS_MAX)
    return { ...this.state.deliveries, [id]: next }
  }

  /** One serial chain; each write takes the latest snapshot, so a later mutation is never lost. */
  private queueWrite(): Promise<void> {
    const run = this.chain.then(() => this.persist())
    this.chain = run.catch(() => undefined)
    return run
  }

  private async persist(): Promise<void> {
    const body = { version: 1, triggers: this.state.triggers, events: this.state.events, deliveries: this.state.deliveries }
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
    const tmp = `${this.file}.tmp`
    await writeFile(tmp, JSON.stringify(body) + '\n', { mode: 0o600 })
    await chmod(tmp, 0o600)
    await rename(tmp, this.file)
  }
}
