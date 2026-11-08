import { HermesRpcError, type Rpc } from '../src/hermes/errors.js'

type Obj = Record<string, unknown>

/** Scripted Hermes: records every call; profiles.list/configure have real compare-and-swap semantics. */
export class FakeRpc {
  rows = new Map<string, { meta?: Obj; rev?: number }>()
  readonly calls: { method: string; params: Obj; timeoutMs?: number }[] = []
  alwaysConflict = false
  rejectWrites = false
  /** Replies for other methods; a function result may throw. */
  readonly handlers = new Map<string, (params: Obj) => unknown>()
  private hook: (() => void) | null = null

  meta(name: string, meta: Obj, rev: number): void {
    this.rows.set(name, { meta, rev })
  }
  onNextConfigure(fn: () => void): void {
    this.hook = fn
  }
  fail(method: string, error: Error): void {
    this.handlers.set(method, () => { throw error })
  }
  methods(): string[] {
    return this.calls.map(c => c.method)
  }
  of(method: string): { method: string; params: Obj; timeoutMs?: number }[] {
    return this.calls.filter(c => c.method === method)
  }
  params(method: string): Obj | undefined {
    return this.of(method)[0]?.params
  }
  get configures(): Obj[] {
    return this.of('profiles.configure').map(c => c.params)
  }

  call: Rpc = async <T>(method: string, params: Obj, timeoutMs?: number) => {
    this.calls.push({ method, params, ...(timeoutMs === undefined ? {} : { timeoutMs }) })
    const handler = this.handlers.get(method)
    if (handler) return handler(params) as T
    if (method === 'profiles.list') {
      return { profiles: [...this.rows].map(([name, r]) => ({
        name,
        ui_meta: r.meta ? { 'hermes-bots': r.meta } : {},
        ui_meta_revisions: r.rev === undefined ? {} : { 'hermes-bots': r.rev }
      })) } as T
    }
    if (method === 'profiles.create') {
      this.rows.set(params.name as string, {})
      return { ok: true, name: params.name } as T
    }
    if (method === 'profiles.configure') {
      const hook = this.hook
      this.hook = null
      hook?.()
      const row = this.rows.get(params.name as string)!
      const expected = (params.ui_meta_expected_revisions as Obj)['hermes-bots']
      const actual = row.rev ?? 0
      if (this.alwaysConflict || expected !== actual) {
        return { ok: false, applied: { ui_meta: false, ui_meta_conflicts: { 'hermes-bots': { expected, actual } }, ui_meta_revisions: { 'hermes-bots': actual } } } as T
      }
      if (this.rejectWrites) return { ok: false, applied: { ui_meta: false } } as T
      row.meta = (params.ui_meta as Obj)['hermes-bots'] as Obj
      row.rev = actual + 1
      return { ok: true, applied: { ui_meta: true, ui_meta_revisions: { 'hermes-bots': row.rev } } } as T
    }
    if (method === 'setup.runtime_check') return { ok: true } as T
    if (method === 'session.create') return { session_id: 's', stored_session_id: 'st' } as T
    if (method === 'profiles.set_asset') return { ok: true, asset: 'avatar', size: 1 } as T
    throw new HermesRpcError(-32601, `unscripted ${method}`)
  }
}
