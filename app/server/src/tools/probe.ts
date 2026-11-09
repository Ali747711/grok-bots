// Phase 0 protocol probe: records what the live Hermes gateway (127.0.0.1:9120) actually speaks.
// Usage (in the VM): npm run probe -w server   → writes docs/phase0/protocol-probe.json
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { loadConfig } from '../config.js'
import { connectGateway, createGatewayClient } from '../hermes/gateway-client.js'
import { HermesToken } from '../hermes/token.js'
import type { GatewayEvent } from '../vendor/hermes/gateway-events.js'
import type { JsonRpcGatewayClient } from '../vendor/hermes/json-rpc-gateway.js'

const OUT = fileURLToPath(new URL('../../../../docs/phase0/protocol-probe.json', import.meta.url))
const PROBED_METHODS = ['session.resume', 'session.create', 'prompt.submit', 'approval.respond', 'approval.pending',
  'approval.received', 'session.interrupt', 'session.events.since', 'request.answer', 'display.status', 'groups.list']

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function attempt(client: JsonRpcGatewayClient, method: string, params: Record<string, unknown>) {
  try {
    return { ok: true, result: await client.request<unknown>(method, params, 15_000) }
  } catch (error) {
    const e = error as { code?: number; message?: string }
    return { ok: false, code: e.code ?? null, message: (e.message ?? String(error)).slice(0, 300) }
  }
}

const FIXTURE_SOUL =
  "You are Crew's test bot. When the user asks you to run a shell command, run exactly that command with the " +
  'terminal tool and report the result. Never rephrase commands.'

/** Task 8: make `crew-test` a Bot Mode bot with a fixed persona (profiles.configure, CAS on a new namespace). */
async function configureFixture(client: JsonRpcGatewayClient): Promise<void> {
  const meta = { title: 'Fixture', color: '#57534e', imageKind: 'shape', custom: true, created: Date.now() }
  const result = await client.request<unknown>('profiles.configure', {
    name: 'crew-test',
    soul: FIXTURE_SOUL,
    ui_meta: { 'hermes-bots': meta },
    ui_meta_expected_revisions: { 'hermes-bots': 0 }
  })
  process.stdout.write(`profiles.configure → ${JSON.stringify(result)}\n`)
}

async function main(): Promise<void> {
  const config = loadConfig(process.env)
  const deps = { config, token: new HermesToken(config.hermesTokenFile) }
  const client = createGatewayClient(deps)
  const events: GatewayEvent[] = []
  client.onAny(event => events.push(event))
  await connectGateway(client, deps)
  if (process.argv.includes('--configure-fixture')) {
    await configureFixture(client)
    client.close()
    return
  }
  await wait(1500)

  const methods: Record<string, unknown> = {}
  for (const method of PROBED_METHODS) {
    // Deliberately invalid params: -32601 means the method is absent; any other error means present.
    methods[method] = await attempt(client, method, { __crew_probe_invalid__: true })
  }

  const report = {
    probedAt: new Date().toISOString(),
    hermesUrl: config.hermesUrl,
    gatewayReady: events.find(e => e.type === 'gateway.ready') ?? null,
    firstEvents: events.slice(0, 10).map(e => ({ type: e.type, session_id: e.session_id })),
    capabilities: await attempt(client, 'client.capabilities', { server_requests: true }),
    profiles: await attempt(client, 'profiles.list', { include_sessions: true }),
    defaultSessions: await attempt(client, 'session.list', { profile: 'default', include_hidden: true }),
    methods
  }
  await writeFile(OUT, JSON.stringify(report, null, 2) + '\n')
  process.stdout.write(`wrote ${OUT}\n`)
  client.close()
}

main().catch(error => {
  process.stderr.write(`probe failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
