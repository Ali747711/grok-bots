import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'

// Test-only access to Hermes on 127.0.0.1:9120 (REST + the JSON-RPC WebSocket the official Webapp uses).
// The session token is read from disk and never printed or put in an error message.

const HERMES = 'http://127.0.0.1:9120'
const NAMESPACE = 'hermes-bots'
const TOKEN_FILE = `${homedir()}/.hermes/webapp/session-token`

const token = (): string => readFileSync(TOKEN_FILE, 'utf8').trim()

/** REST call to Hermes with the session token; JSON in, parsed JSON (or null) out. */
export async function hermesRest(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${HERMES}${path}`, {
    method,
    headers: { 'X-Hermes-Session-Token': token(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
  const text = await res.text()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = text
  }
  return { status: res.status, body: parsed }
}

export interface ProfileRow {
  name: string
  description?: string | null
  has_avatar?: boolean
  ui_meta?: Record<string, Record<string, unknown>> | null
  ui_meta_revisions?: Record<string, number> | null
  canonical_session?: { title?: string | null } | null
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }

/** One short-lived JSON-RPC connection: waits for `gateway.ready`, then request/response by id. */
export class HermesRpc {
  private nextId = 1
  private readonly pending = new Map<number, Pending>()

  private constructor(private readonly ws: WebSocket) {
    ws.onmessage = event => {
      const msg = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message?: string } }
      if (msg.id === undefined) return
      const waiter = this.pending.get(msg.id)
      if (!waiter) return
      this.pending.delete(msg.id)
      if (msg.error) waiter.reject(new Error(`rpc error: ${msg.error.message ?? 'unknown'}`))
      else waiter.resolve(msg.result)
    }
  }

  static async connect(): Promise<HermesRpc> {
    const ws = new WebSocket(`ws://127.0.0.1:9120/api/ws?token=${token()}`)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('hermes websocket: no gateway.ready in 15 s')), 15_000)
      ws.onerror = () => {
        clearTimeout(timer)
        reject(new Error('hermes websocket failed to connect'))
      }
      ws.onmessage = event => {
        const msg = JSON.parse(String(event.data)) as { params?: { type?: string } }
        if (msg.params?.type === 'gateway.ready') {
          clearTimeout(timer)
          resolve()
        }
      }
    })
    return new HermesRpc(ws)
  }

  call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: v => resolve(v as T), reject })
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  }

  close(): void {
    this.ws.close()
  }
}

/** Run `fn` with a fresh connection and close it afterwards. */
export async function withRpc<T>(fn: (rpc: HermesRpc) => Promise<T>): Promise<T> {
  const rpc = await HermesRpc.connect()
  try {
    return await fn(rpc)
  } finally {
    rpc.close()
  }
}

export const profileRows = (): Promise<ProfileRow[]> =>
  withRpc(async rpc => (await rpc.call<{ profiles: ProfileRow[] }>('profiles.list', { include_sessions: true })).profiles)

export async function profileRow(name: string): Promise<ProfileRow | undefined> {
  return (await profileRows()).find(p => p.name === name)
}

/**
 * What the official Webapp does when the user pins a bot: read the whole `hermes-bots` object and its
 * revision, then write the whole object plus `pinned: true` with the expected revision (compare-and-swap).
 */
export async function pinFromOtherUi(name: string): Promise<void> {
  await withRpc(async rpc => {
    const rows = (await rpc.call<{ profiles: ProfileRow[] }>('profiles.list', { include_sessions: false })).profiles
    const row = rows.find(p => p.name === name)
    if (!row) throw new Error(`no profile ${name}`)
    const meta = row.ui_meta?.[NAMESPACE] ?? {}
    const revision = row.ui_meta_revisions?.[NAMESPACE] ?? 0
    const reply = await rpc.call<{ applied?: { ui_meta?: boolean; ui_meta_conflicts?: unknown } }>('profiles.configure', {
      name,
      ui_meta: { [NAMESPACE]: { ...meta, pinned: true } },
      ui_meta_expected_revisions: { [NAMESPACE]: revision }
    })
    if (reply.applied?.ui_meta !== true || reply.applied.ui_meta_conflicts) throw new Error('the other-UI pin was not applied')
  })
}

export const testBotNames = (names: readonly string[]): string[] => names.filter(n => /^e2e\d+$/.test(n))
