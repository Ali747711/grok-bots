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

// ---- Groups (Phase 4). Every `groups.*` call is made as the owner profile `default`. ----

const OWNER = 'default'

export interface RoomRow {
  room_id: string
  name: string
  members: { member_id: string; profile: string; handle: string }[]
}

export interface RoomStateRow {
  room: { room_id: string; name: string }
  context?: { routing: string; lead_member_id: string; purpose: string; notes: string }
  driver_status?: { working: boolean }
}

export interface RoomEventRow {
  seq: number
  kind: string
  actor: { kind: string; id: string; profile?: string }
  payload: Record<string, unknown>
}

/** A test bot: profiles.create with exactly Crew's own params (no model call). */
export async function createTestBot(name: string): Promise<void> {
  if (!/^e2e\d+$/.test(name)) throw new Error('test bots are named e2e<digits>')
  await withRpc(rpc => rpc.call('profiles.create', { name, description: 'e2e', clone_from: 'default', share_auth: true, no_skills: false }))
}

/** A new profile becomes seatable within about 3 s; wait for Hermes to say so. */
export async function waitSeatable(name: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const caps = await withRpc(rpc => rpc.call<{ seatable_profiles: string[] }>('groups.capabilities', { profile: OWNER }))
    if (caps.seatable_profiles.includes(name)) return
    if (Date.now() > deadline) throw new Error(`${name} did not become seatable`)
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
}

export const listGroups = (): Promise<RoomRow[]> =>
  withRpc(async rpc => {
    const rooms: RoomRow[] = []
    let offset = 0
    for (;;) {
      const page = await rpc.call<{ rooms: RoomRow[]; next_offset: number | null }>('groups.list', { profile: OWNER, limit: 100, ...(offset > 0 ? { offset } : {}) })
      rooms.push(...page.rooms)
      if (typeof page.next_offset !== 'number' || page.rooms.length === 0) return rooms
      offset = page.next_offset
    }
  })

export const groupState = (roomId: string): Promise<RoomStateRow> =>
  withRpc(rpc => rpc.call<RoomStateRow>('groups.state', { profile: OWNER, room_id: roomId }))

export const groupEvents = (roomId: string): Promise<RoomEventRow[]> =>
  withRpc(async rpc => (await rpc.call<{ events: RoomEventRow[] }>('groups.log', { profile: OWNER, room_id: roomId, since_seq: 0, limit: 500 })).events)

/** Make a room the way the official Webapp does (RPC, not Crew). */
export async function createRoomViaRpc(name: string, profiles: readonly string[]): Promise<string> {
  const roomId = crypto.randomUUID()
  const members = profiles.map(p => ({ member_id: p, profile: p, handle: p === 'default' ? 'hermes' : p, target: { kind: 'local', profile: p } }))
  await withRpc(rpc => rpc.call('groups.create', { profile: OWNER, room_id: roomId, name, members }))
  return roomId
}

const isTestMember = (profile: string): boolean => profile === 'crew-test' || /^e2e\d+$/.test(profile)

/** Disband a room (stop first; retry while Hermes says work is still stopping). */
export async function disbandGroup(roomId: string): Promise<void> {
  const cancelId = crypto.randomUUID()
  await withRpc(rpc => rpc.call('groups.stop', { profile: OWNER, room_id: roomId, cancel_id: cancelId }))
  for (let attempt = 0; ; attempt++) {
    try {
      await withRpc(rpc => rpc.call('groups.disband', { profile: OWNER, room_id: roomId, cancel_id: cancelId }))
      return
    } catch (error) {
      if (attempt >= 10) throw error
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
}

/** Disband only rooms whose members are all crew-test or e2e<digits>. Any other room is never touched. */
export async function deleteTestGroups(): Promise<string[]> {
  const mine = (await listGroups()).filter(r => r.members.length > 0 && r.members.every(m => isTestMember(m.profile)))
  const done: string[] = []
  for (const room of mine) {
    try {
      await disbandGroup(room.room_id)
      done.push(room.room_id)
    } catch {
      // A room that will not disband is left for the next run's cleanup.
    }
  }
  return done
}

// ---- Triggers (Phase 5). Only crew-test's jobs are ever read or deleted. ----

const TEST_BOT = 'crew-test'

export interface CronJob {
  id: string
  name: string
  paused_reason?: string | null
  schedule?: unknown
  enabled?: boolean
}

export async function cronJobsOf(bot: string): Promise<CronJob[]> {
  const res = await hermesRest('GET', `/api/cron/jobs?profile=${encodeURIComponent(bot)}`)
  if (res.status !== 200 || !Array.isArray(res.body)) throw new Error(`cron list answered ${res.status}`)
  return res.body as CronJob[]
}

async function deleteJobsNamed(startsWith: string): Promise<number> {
  const jobs = (await cronJobsOf(TEST_BOT)).filter(j => j.name.startsWith(startsWith))
  for (const job of jobs) await hermesRest('DELETE', `/api/cron/jobs/${encodeURIComponent(job.id)}?profile=${TEST_BOT}`)
  return jobs.length
}

/** Leftover one-shots of trigger events on crew-test (their names start `[trigger:`). */
export const deleteTriggerJobs = (): Promise<number> => deleteJobsNamed('[trigger:')

/** Routines the specs made on crew-test: Hermes names them `[bot:crew-test] <title>`. */
export const deleteTestRoutines = (prefix: string): Promise<number> => deleteJobsNamed(`[bot:${TEST_BOT}] ${prefix}`)

/** The messages of one session, as Hermes stores them (the stored prompt of a triggered run is the first). */
export async function sessionMessages(bot: string, sessionId: string): Promise<{ role: string; content: string }[]> {
  const res = await hermesRest('GET', `/api/sessions/${encodeURIComponent(sessionId)}/messages?profile=${encodeURIComponent(bot)}&limit=50&order=oldest`)
  const rows = (res.body as { messages?: { role: string; content: unknown }[] } | null)?.messages ?? []
  return rows.map(r => ({ role: r.role, content: typeof r.content === 'string' ? r.content : JSON.stringify(r.content) }))
}
