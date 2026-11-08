import { JsonRpcGatewayClient } from '@/vendor/hermes/json-rpc-gateway'

const RECONNECT_MIN_MS = 1000
const RECONNECT_MAX_MS = 15_000

let shared: JsonRpcGatewayClient | null = null

function gatewayUrl(): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${location.host}/api/ws`
}

/**
 * The page's single gateway client. Its sequence watermarks drive event replay after a reconnect, so
 * there must only ever be one. Connects on first call and redials after a close (1 s doubling to 15 s).
 * The session cookie and Origin travel with the upgrade automatically.
 */
export function connectGateway(): JsonRpcGatewayClient {
  if (shared) return shared
  const client = new JsonRpcGatewayClient({ requestIdPrefix: 'web' })
  shared = client
  // Accept server requests (approvals, secrets, sudo) but never reply. An error reply, including the
  // channel's default -32601, makes Hermes treat the request as skipped for every client. Crew answers
  // only through POST /crew/requests/:id/answer.
  client.onRequest(() => true)
  let attempt = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const dial = () => {
    timer = null
    void client.connect(gatewayUrl()).catch(() => undefined)
  }
  client.onState(state => {
    if (state === 'open') attempt = 0
    if ((state === 'closed' || state === 'error') && !timer) {
      timer = setTimeout(dial, Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** attempt))
      attempt += 1
    }
  })
  dial()
  return client
}
