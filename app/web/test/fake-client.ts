import type { ChatClient } from '@/chat/chat-session'
import type { GatewayEvent } from '@/vendor/hermes/gateway-events'

type Handler = (params: Record<string, unknown>) => unknown

/** Scriptable stand-in for the vendored gateway client (no network, no LLM). */
export class FakeClient implements ChatClient {
  calls: { method: string; params: Record<string, unknown>; timeoutMs?: number }[] = []
  handlers: Record<string, Handler> = {}
  state = 'open'
  private anyHandlers = new Set<(event: GatewayEvent) => void>()
  private stateHandlers = new Set<(state: string) => void>()

  get connectionState(): string {
    return this.state
  }

  request<T>(method: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> {
    this.calls.push({ method, params, ...(timeoutMs !== undefined ? { timeoutMs } : {}) })
    try {
      return Promise.resolve(this.handlers[method]?.(params) as T)
    } catch (error) {
      return Promise.reject(error)
    }
  }

  onAny(handler: (event: GatewayEvent) => void): () => void {
    this.anyHandlers.add(handler)
    return () => this.anyHandlers.delete(handler)
  }

  onState(handler: (state: string) => void): () => void {
    this.stateHandlers.add(handler)
    handler(this.state)
    return () => this.stateHandlers.delete(handler)
  }

  emit(event: Record<string, unknown>): void {
    for (const h of [...this.anyHandlers]) h(event as unknown as GatewayEvent)
  }

  setState(state: string): void {
    this.state = state
    for (const h of [...this.stateHandlers]) h(state)
  }

  callsOf(method: string) {
    return this.calls.filter(c => c.method === method)
  }
}
