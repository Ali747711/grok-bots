import type { ChatClient } from '@/chat/chat-session'

type Handler = (params: Record<string, unknown>) => unknown

/** Scriptable stand-in for the vendored gateway client (no network, no LLM). */
export class FakeClient implements ChatClient {
  calls: { method: string; params: Record<string, unknown>; timeoutMs?: number }[] = []
  handlers: Record<string, Handler> = {}
  state = 'open'
  private anyHandlers = new Set<(event: unknown) => void>()
  private stateHandlers = new Set<(state: string) => void>()

  request<T>(method: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> {
    this.calls.push({ method, params, ...(timeoutMs !== undefined ? { timeoutMs } : {}) })
    try {
      return Promise.resolve(this.handlers[method]?.(params) as T)
    } catch (error) {
      return Promise.reject(error)
    }
  }

  onAny(handler: (event: never) => void): () => void {
    const h = handler as (event: unknown) => void
    this.anyHandlers.add(h)
    return () => this.anyHandlers.delete(h)
  }

  onState(handler: (state: string) => void): () => void {
    this.stateHandlers.add(handler)
    handler(this.state)
    return () => this.stateHandlers.delete(handler)
  }

  emit(event: Record<string, unknown>): void {
    for (const h of [...this.anyHandlers]) h(event)
  }

  setState(state: string): void {
    this.state = state
    for (const h of [...this.stateHandlers]) h(state)
  }

  callsOf(method: string) {
    return this.calls.filter(c => c.method === method)
  }
}
