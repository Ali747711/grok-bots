import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'

import { toGroupEvent } from '../groups/group-events.js'
import type { GroupRpc } from '../groups/group-rpc.js'
import { groupErrorReason } from '../groups/group-rpc.js'
import type { GroupWatcher } from '../groups/group-watcher.js'
import { buildMemberRows, defaultGroupName, validateMembers } from '../groups/members.js'
import { HermesRpcError, HermesUnavailableError } from '../hermes/errors.js'
import { log } from '../log.js'
import type { CrewEnv } from './session-guard.js'

export interface GroupRouteDeps {
  rpc: GroupRpc
  groups: Pick<GroupWatcher, 'state' | 'seatable' | 'refreshRoom' | 'refreshList'>
  roster: () => readonly { name: string; title: string; displayName: string | null }[]
  newId: () => string
  sleep: (ms: number) => Promise<void>
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const MAX_TEXT_BYTES = 65_536
const DISBAND_TRIES = 10
const DISBAND_WAIT_MS = 1000
const id = z.string().regex(ID_RE).max(128)
const name = z.string().trim().min(1).max(64)

const createBody = z.object({ name: name.optional(), members: z.array(z.string()).min(2).max(6) }).strict()
const messageBody = z.object({
  eventId: id,
  text: z.string().refine(t => t.length > 0 && Buffer.byteLength(t, 'utf8') <= MAX_TEXT_BYTES),
  threadId: id.optional()
}).strict()
const stopBody = z.object({ cancelId: id }).strict()
const continueBody = z.object({ discussionEventId: id }).strict()
const turnBody = z.object({ memberId: z.string().min(1), taskId: z.string().min(1), executionGeneration: z.number().int().min(1) }).strict()
const renameBody = z.object({ name }).strict()
const contextBody = z.object({
  routing: z.enum(['everyone', 'auto', 'lead']),
  leadMemberId: z.string().optional(),
  purpose: z.string().max(500),
  notes: z.string().max(4096)
}).strict()
const eventsQuery = z.object({
  since: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100)
})

/** Hermes's own reason when it gave one, else the message; nothing else is shown. */
const detailOf = (error: unknown): string =>
  (groupErrorReason(error)?.detail ?? (error instanceof HermesRpcError ? error.message : 'request failed')).slice(0, 300)

/**
 * Hermes raises "room work is still stopping" as a bare RuntimeError, which its socket answers as
 * -32603 "internal error" with no data; the message only shows when a handler maps it.
 */
const isStillStopping = (error: unknown): boolean =>
  error instanceof HermesRpcError && (error.code === -32603 || /still stopping/i.test(error.message))

/** `/crew/groups` family: thin, validated pass-throughs to Hermes rooms (always as the owner profile). */
export function groupRoutes(deps: GroupRouteDeps | undefined): Hono<CrewEnv> {
  const routes = new Hono<CrewEnv>()
  routes.use('/crew/groups', async (c, next) => (deps ? next() : c.json({ error: 'hermes_offline' }, 503)))
  routes.use('/crew/groups/*', async (c, next) => (deps ? next() : c.json({ error: 'hermes_offline' }, 503)))

  const bad = (c: Context, message: string) => c.json({ error: 'bad_body', message }, 400)
  const body = async <T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T> | Response> => {
    const parsed = schema.safeParse(await c.req.json().catch(() => null))
    return parsed.success ? parsed.data : bad(c, parsed.error.issues[0]?.message ?? 'invalid body')
  }
  const failure = (c: Context, error: unknown): Response => {
    if (error instanceof HermesUnavailableError) return c.json({ error: 'hermes_offline' }, 503)
    if (groupErrorReason(error)?.reason === 'permission_denied') return c.json({ error: 'not_found' }, 404)
    log.warn('group call refused', { reason: groupErrorReason(error)?.reason ?? null, message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' })
    return c.json({ error: 'hermes_refused', detail: detailOf(error) }, 502)
  }
  const run = async (c: Context, action: () => Promise<Response>): Promise<Response> => {
    try {
      return await action()
    } catch (error) {
      return failure(c, error)
    }
  }
  const settle = (refresh: Promise<void>): void => void refresh.catch(() => undefined)
  const roomOf = (roomId: string) => deps!.groups.state().rooms.find(r => r.id === roomId)

  routes.post('/crew/groups', async c => {
    const parsed = await body(c, createBody)
    if (parsed instanceof Response) return parsed
    const d = deps!
    if (!d.groups.state().available) return c.json({ error: 'groups_unavailable' }, 409)
    const roster = d.roster()
    const check = validateMembers(parsed.members, new Set(roster.map(b => b.name)), d.groups.seatable())
    if (!check.ok) return c.json({ error: 'bad_members', reason: check.reason, ...(check.profile ? { profile: check.profile } : {}) }, 400)
    const byName = new Map(roster.map(b => [b.name, b]))
    const displayNames = new Map(roster.flatMap(b => (b.displayName ? [[b.name, b.displayName] as const] : [])))
    const groupName = parsed.name ?? defaultGroupName(parsed.members.map(m => byName.get(m)?.title ?? m))
    return run(c, async () => {
      const roomId = d.newId()
      await d.rpc.create({ roomId, name: groupName, members: buildMemberRows(parsed.members, displayNames) })
      // The list is refreshed after routing is set, so the group reaches the browser already on Auto
      // (an unknown group would bounce the user home after the grace period). A refresh error never fails the reply.
      const refreshed = async (): Promise<void> => {
        await d.groups.refreshList().catch(() => undefined)
      }
      try {
        await d.rpc.setContext(roomId, { routing: 'auto', leadMemberId: '', purpose: '', notes: '' })
        await refreshed()
        return c.json({ roomId, routing: 'auto' }, 201)
      } catch (error) {
        log.warn('group routing not set', { message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' })
        await refreshed()
        return c.json({ roomId, routing: 'everyone', warning: 'routing_not_set' }, 201)
      }
    })
  })

  routes.get('/crew/groups/:id/events', async c => {
    const q = eventsQuery.safeParse(c.req.query())
    if (!q.success) return bad(c, q.error.issues[0]?.message ?? 'invalid query')
    return run(c, async () => {
      const page = await deps!.rpc.log(c.req.param('id'), q.data.since, q.data.limit)
      return c.json({ events: page.events.map(toGroupEvent), cursor: page.cursor, latestSeq: page.latest_seq, hasMore: page.has_more, epoch: page.authority.epoch })
    })
  })

  routes.post('/crew/groups/:id/messages', async c => {
    const parsed = await body(c, messageBody)
    if (parsed instanceof Response) return parsed
    const roomId = c.req.param('id')
    try {
      const sent = await deps!.rpc.send(roomId, { eventId: parsed.eventId, text: parsed.text, threadId: parsed.threadId ?? parsed.eventId })
      settle(deps!.groups.refreshRoom(roomId))
      return c.json({ accepted: true, seq: sent.seq }, 202)
    } catch (error) {
      if (error instanceof HermesUnavailableError) return c.json({ error: 'hermes_offline', admitted: false }, 503)
      const info = groupErrorReason(error)
      if (info?.reason === 'permission_denied') return c.json({ error: 'not_found' }, 404)
      // Without `admitted:false` the message may or may not be stored; the client retries with the same eventId.
      if (info?.admitted === false) return c.json({ admitted: false, reason: info.reason }, 409)
      return c.json({ admitted: 'unknown' }, 502)
    }
  })

  routes.post('/crew/groups/:id/stop', async c => {
    const parsed = await body(c, stopBody)
    if (parsed instanceof Response) return parsed
    const roomId = c.req.param('id')
    return run(c, async () => {
      const r = await deps!.rpc.stop(roomId, parsed.cancelId)
      settle(deps!.groups.refreshRoom(roomId))
      return c.json({ cancelled: r.cancelled })
    })
  })

  routes.post('/crew/groups/:id/continue', async c => {
    const parsed = await body(c, continueBody)
    if (parsed instanceof Response) return parsed
    const roomId = c.req.param('id')
    return run(c, async () => {
      await deps!.rpc.continueDiscussion(roomId, parsed.discussionEventId)
      settle(deps!.groups.refreshRoom(roomId))
      return c.body(null, 204)
    })
  })

  for (const kind of ['retry', 'discard'] as const) {
    routes.post(`/crew/groups/:id/turns/${kind}`, async c => {
      const parsed = await body(c, turnBody)
      if (parsed instanceof Response) return parsed
      const roomId = c.req.param('id')
      const room = roomOf(roomId)
      if (!room) return c.json({ error: 'not_found' }, 404)
      const offered = room.turnActions.some(a => a.kind === kind && a.memberId === parsed.memberId && a.taskId === parsed.taskId && a.executionGeneration === parsed.executionGeneration)
      if (!offered) return c.json({ error: 'no_such_action' }, 409)
      return run(c, async () => {
        await deps!.rpc[kind](roomId, parsed)
        settle(deps!.groups.refreshRoom(roomId))
        return c.body(null, 204)
      })
    })
  }

  routes.patch('/crew/groups/:id', async c => {
    const parsed = await body(c, renameBody)
    if (parsed instanceof Response) return parsed
    const roomId = c.req.param('id')
    return run(c, async () => {
      await deps!.rpc.rename(roomId, parsed.name)
      settle(deps!.groups.refreshRoom(roomId))
      return c.json({ name: parsed.name })
    })
  })

  routes.put('/crew/groups/:id/context', async c => {
    const parsed = await body(c, contextBody)
    if (parsed instanceof Response) return parsed
    const roomId = c.req.param('id')
    const room = roomOf(roomId)
    if (!room) return c.json({ error: 'not_found' }, 404)
    const lead = parsed.leadMemberId ?? ''
    if (parsed.routing === 'lead' && !room.members.some(m => m.memberId === lead)) return bad(c, 'lead routing needs a member as lead')
    return run(c, async () => {
      const ctx = await deps!.rpc.setContext(roomId, { routing: parsed.routing, leadMemberId: lead, purpose: parsed.purpose, notes: parsed.notes })
      settle(deps!.groups.refreshRoom(roomId))
      return c.json({ routing: ctx.routing, leadMemberId: ctx.lead_member_id || null, purpose: ctx.purpose, notes: ctx.notes })
    })
  })

  routes.delete('/crew/groups/:id', c => run(c, async () => {
    const d = deps!
    const roomId = c.req.param('id')
    const cancelId = d.newId()
    await d.rpc.stop(roomId, cancelId)
    for (let attempt = 1; attempt <= DISBAND_TRIES; attempt++) {
      try {
        await d.rpc.disband(roomId, cancelId)
        settle(d.groups.refreshList())
        return c.body(null, 204)
      } catch (error) {
        if (!isStillStopping(error)) throw error
        if (attempt < DISBAND_TRIES) await d.sleep(DISBAND_WAIT_MS)
      }
    }
    return c.json({ error: 'still_stopping' }, 409)
  }))

  return routes
}
