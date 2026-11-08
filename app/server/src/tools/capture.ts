// Dev tool: records one real turn so the web reducer is built from Hermes's actual shapes.
// Usage (in the VM): npm run capture -w server -- <profile> "<prompt>"
// Writes app/web/test/fixtures/turn-frames.json (events exactly as the vendored client delivers them)
// and history-rows.json (the REST messages response as-is). The Hermes token is never written.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadConfig } from '../config.js'
import { connectGateway, createGatewayClient } from '../hermes/gateway-client.js'
import { HermesToken } from '../hermes/token.js'
import type { GatewayEvent } from '../vendor/hermes/gateway-events.js'

const OUT_DIR = fileURLToPath(new URL('../../../web/test/fixtures/', import.meta.url))
const RPC_TIMEOUT_MS = 1_800_000
const COMPLETE_CAP_MS = 180_000
const TRAILING_MS = 1000

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

interface ProfileRow {
  name: string
  canonical_session?: { id?: string; resolved_id?: string } | null
}

/** Name the failing RPC in the error (Hermes errors like `permission_denied` do not say which call). */
async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function main(): Promise<void> {
  const [profile, prompt] = process.argv.slice(2)
  if (!profile || !prompt) throw new Error('usage: capture <profile> "<prompt>"')
  const config = loadConfig(process.env)
  const token = new HermesToken(config.hermesTokenFile)
  const deps = { config, token }
  const client = createGatewayClient(deps)
  await connectGateway(client, deps)

  const { profiles } = await step('profiles.list', () => client.request<{ profiles: ProfileRow[] }>('profiles.list', { include_sessions: true }))
  const row = profiles.find(p => p.name === profile)
  if (!row) throw new Error(`unknown profile ${profile}`)
  const canonical = row.canonical_session
  const storedId = canonical?.resolved_id ?? canonical?.id
  const created = storedId
    ? null
    : await step('session.create', () => client.request<{ session_id: string }>('session.create', { profile, title: 'Bot Chat', hidden: true, follow_profile_config: true }))
  const resumed = await step('session.resume', () => client.request<{ session_id: string }>('session.resume', {
    profile,
    session_id: storedId ?? created?.session_id,
    omit_messages: true
  }))
  const sessionId = resumed.session_id

  const frames: GatewayEvent[] = []
  let complete = false
  client.onAny(event => {
    if (event.session_id !== sessionId) return
    frames.push(event)
    if (event.type === 'message.complete') complete = true
  })

  await step('prompt.submit', () => client.request('prompt.submit', { session_id: sessionId, profile, text: prompt, submission_id: crypto.randomUUID(), surface: 'hud' }, RPC_TIMEOUT_MS))
  const deadline = Date.now() + COMPLETE_CAP_MS
  while (!complete && Date.now() < deadline) await wait(250)
  await wait(TRAILING_MS)

  const url = `${config.hermesUrl}/api/sessions/${encodeURIComponent(sessionId)}/messages?profile=${encodeURIComponent(profile)}&limit=120&order=latest&include_compacted=true`
  const res = await fetch(url, { headers: { 'X-Hermes-Session-Token': await token.get() } })
  if (!res.ok) throw new Error(`history request failed: ${res.status}`)
  const history: unknown = await res.json()

  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(join(OUT_DIR, 'turn-frames.json'), JSON.stringify(frames, null, 2) + '\n')
  await writeFile(join(OUT_DIR, 'history-rows.json'), JSON.stringify(history, null, 2) + '\n')
  process.stdout.write(`captured ${frames.length} frames (complete=${complete}) for session ${sessionId}\n`)
  client.close()
}

main().catch(error => {
  process.stderr.write(`capture failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
