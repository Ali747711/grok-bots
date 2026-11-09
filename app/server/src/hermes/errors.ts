/** Crew's view of a Hermes JSON-RPC call: same shape as the gateway client's `request`. */
export type Rpc = <T>(method: string, params: Record<string, unknown>, timeoutMs?: number) => Promise<T>

/** The upstream connection is not up, so no frame was sent. */
export class HermesUnavailableError extends Error {
  constructor(message = 'hermes is not connected') {
    super(message)
    this.name = 'HermesUnavailableError'
  }
}

/** A JSON-RPC error reply, with the code and message exactly as Hermes sent them. */
export class HermesRpcError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message)
    this.name = 'HermesRpcError'
  }
}

/** A non-2xx REST reply; `detail` comes from the JSON `detail` | `error` | `message` field. */
export class HermesRestError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string
  ) {
    super(`hermes ${status}: ${detail}`)
    this.name = 'HermesRestError'
  }
}
