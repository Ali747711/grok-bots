import { createHash, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { z } from 'zod'

import { log } from '../log.js'
import type { ToolHint } from './composio.js'
import type { AllowList, AppLevel } from './levels.js'
import { APP_LEVELS, TOOLKIT_RE } from './levels.js'

const level = z.enum(APP_LEVELS as [AppLevel, ...AppLevel[]])
const slugKey = z.string().regex(TOOLKIT_RE)
const recordSchema = z.object({
  apps: z.record(slugKey, level), counts: z.record(slugKey, z.object({ tools: z.number().int(), capped: z.boolean() })),
  sessionId: z.string(), mcpUrl: z.string(), allowed: z.array(z.string()), tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
  identity: z.boolean().optional()
})
const hint = z.object({ slug: z.string(), readOnly: z.boolean(), destructive: z.boolean() })
const toolkitSchema = z.object({ fetchedAt: z.number(), hintsVersion: z.number().optional(), tools: z.array(hint) })
const pendingSchema = z.object({ id: z.string(), toolkit: slugKey, startedAt: z.number() })
const fileSchema = z.object({
  version: z.literal(1), userId: z.uuid(),
  bots: z.record(z.string(), recordSchema), toolkits: z.record(slugKey, toolkitSchema),
  names: z.record(slugKey, z.string()), pending: z.array(pendingSchema)
})

export interface BotRecord {
  readonly apps: Readonly<Record<string, AppLevel>>
  readonly counts: AllowList['byApp']
  readonly sessionId: string
  readonly mcpUrl: string
  readonly allowed: readonly string[]
  readonly tokenHash: string
  /** True once the bot's Hermes entry was written with the identity header; absent on older records until the backfill. */
  readonly identity?: boolean
}
export interface ToolkitEntry { readonly fetchedAt: number; readonly hintsVersion?: number; readonly tools: readonly ToolHint[] }
export interface PendingSignIn { readonly id: string; readonly toolkit: string; readonly startedAt: number }

interface State {
  readonly userId: string
  readonly bots: Readonly<Record<string, BotRecord>>
  readonly toolkits: Readonly<Record<string, ToolkitEntry>>
  readonly names: Readonly<Record<string, string>>
  readonly pending: readonly PendingSignIn[]
}

/** The record without its identity mark: the mark is set only after Hermes holds an entry that carries the header. */
export function unmarked(record: BotRecord): BotRecord {
  const { identity: _mark, ...rest } = record
  return rest
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

const DUMMY_HASH = hashToken('crew-no-such-bot')

/** One timingSafeEqual per check, against a dummy hash when there is no record or token. */
export function tokenMatches(record: BotRecord | undefined, token: string | null): boolean {
  const expected = Buffer.from(record?.tokenHash ?? DUMMY_HASH, 'hex')
  const given = Buffer.from(hashToken(token ?? ''), 'hex')
  return timingSafeEqual(expected, given) && record !== undefined && token !== null
}

/** A lookup that never answers with an Object.prototype member (a bot named `constructor`). */
function own<T>(map: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined
}

function withoutKey<T>(map: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const { [key]: _drop, ...rest } = map
  return rest
}

/** The userId of a damaged file, when it still parses as a real UUID (R13); never `default`. */
function salvageUserId(raw: string): string | undefined {
  try {
    const id = (JSON.parse(raw) as { userId?: unknown }).userId
    return z.uuid().safeParse(id).success ? (id as string) : undefined
  } catch {
    return undefined
  }
}

/**
 * Per-bot app records (token hashes only), cached tools, names and open sign-ins in
 * `<stateDir>/connectors.json` (0600, tmp + rename), written through one serial chain like `TriggerStore`.
 */
export class ConnectorStore {
  private chain: Promise<unknown> = Promise.resolve()
  private readonly recordListeners = new Set<(bot: string) => void>()

  private constructor(private readonly file: string, private state: State) {}

  static async load(file: string, newUserId: () => string): Promise<ConnectorStore> {
    let raw: string | undefined
    try {
      raw = await readFile(file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const fresh = (userId: string): State => ({ userId, bots: {}, toolkits: {}, names: {}, pending: [] })
    if (raw === undefined) return ConnectorStore.created(file, fresh(newUserId()))
    let parsed: z.infer<typeof fileSchema> | undefined
    try {
      const result = fileSchema.safeParse(JSON.parse(raw))
      if (result.success) parsed = result.data
    } catch {
      // invalid JSON: handled below like a schema failure
    }
    if (parsed) return new ConnectorStore(file, parsed)
    await rename(file, `${file}.corrupt-${Date.now()}`)
    log.error('connectors file invalid, moved aside', { file })
    return ConnectorStore.created(file, fresh(salvageUserId(raw) ?? newUserId()))
  }

  private static async created(file: string, state: State): Promise<ConnectorStore> {
    const store = new ConnectorStore(file, state)
    await store.queueWrite()
    return store
  }

  userId(): string { return this.state.userId }
  bots(): readonly string[] { return Object.keys(this.state.bots) }
  record(bot: string): BotRecord | undefined { return own(this.state.bots, bot) }
  toolkit(slug: string): ToolkitEntry | undefined { return own(this.state.toolkits, slug) }
  name(slug: string): string | undefined { return own(this.state.names, slug) }
  pending(): readonly PendingSignIn[] { return this.state.pending }

  setRecord(bot: string, record: BotRecord): Promise<void> {
    return this.change({ bots: { ...this.state.bots, [bot]: record } }).then(() => this.recordChanged(bot))
  }

  deleteRecord(bot: string): Promise<void> {
    return this.change({ bots: withoutKey(this.state.bots, bot) }).then(() => this.recordChanged(bot))
  }

  /** Called after a bot's record was saved or removed (the "Right now" block lists its apps). */
  onRecordChange(listener: (bot: string) => void): () => void {
    this.recordListeners.add(listener)
    return () => {
      this.recordListeners.delete(listener)
    }
  }

  private recordChanged(bot: string): void {
    for (const listener of [...this.recordListeners]) listener(bot)
  }

  setToolkit(slug: string, entry: ToolkitEntry): Promise<void> {
    return this.change({ toolkits: { ...this.state.toolkits, [slug]: entry } })
  }

  setName(slug: string, name: string): Promise<void> {
    return this.change({ names: { ...this.state.names, [slug]: name } })
  }

  addPending(p: PendingSignIn): Promise<void> {
    return this.change({ pending: [...this.state.pending.filter(x => x.id !== p.id), p] })
  }

  removePending(id: string): Promise<void> {
    return this.change({ pending: this.state.pending.filter(x => x.id !== id) })
  }

  private change(patch: Partial<State>): Promise<void> {
    this.state = { ...this.state, ...patch }
    return this.queueWrite()
  }

  /** One serial chain; each write takes the latest snapshot, so a later mutation is never lost. */
  private queueWrite(): Promise<void> {
    const run = this.chain.then(() => this.persist())
    this.chain = run.catch(() => undefined)
    return run
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
    const tmp = `${this.file}.tmp`
    await writeFile(tmp, JSON.stringify({ version: 1, ...this.state }) + '\n', { mode: 0o600 })
    await chmod(tmp, 0o600)
    await rename(tmp, this.file)
  }
}

/** An unreadable file must not crash-loop Crew: log the code only (the message could carry contents), return null. */
export async function loadConnectorStore(file: string, newUserId: () => string): Promise<ConnectorStore | null> {
  try {
    return await ConnectorStore.load(file, newUserId)
  } catch (error) {
    log.error('connectors file unreadable, connectors disabled', { file, code: (error as NodeJS.ErrnoException).code ?? 'unknown' })
    return null
  }
}
