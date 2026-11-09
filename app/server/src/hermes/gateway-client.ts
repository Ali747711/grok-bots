import type { CrewConfig } from '../config.js'
import { log } from '../log.js'
import { JsonRpcGatewayClient } from '../vendor/hermes/json-rpc-gateway.js'
import type { HermesToken } from './token.js'

/** Hermes's JSON-RPC WebSocket URL; the token can only travel as a query parameter on upgrades. */
export function gatewayWsUrl(hermesUrl: string, token: string): string {
  return `${hermesUrl.replace(/^http/, 'ws')}/api/ws?token=${encodeURIComponent(token)}`
}

export interface GatewayClientDeps {
  readonly config: CrewConfig
  readonly token: HermesToken
}

/**
 * Server-side Hermes client (direct loopback connection, not through Crew's proxy), using Node's
 * built-in WebSocket. Unhandled server requests are logged; the vendored channel answers them -32601.
 */
export function createGatewayClient(_deps: GatewayClientDeps): JsonRpcGatewayClient {
  return new JsonRpcGatewayClient({
    requestIdPrefix: 'crew',
    onUnhandledRequest: request => log.warn('unhandled hermes server request', { method: request.method }),
    onRequestHandlerError: (error, request) =>
      log.error('hermes server request handler failed', { method: request.method, error: error.message })
  })
}

/** Connect `client` with the current token. */
export async function connectGateway(client: JsonRpcGatewayClient, deps: GatewayClientDeps): Promise<void> {
  await client.connect(gatewayWsUrl(deps.config.hermesUrl, await deps.token.get()))
}
