// Copies of the server's shapes (app/server/src/connectors); never imported from there.
export type AppLevel = 'read' | 'change' | 'all'
export type AccountStatus = 'connected' | 'pending' | 'failed'
export interface Toolkit { readonly slug: string; readonly name: string }
export interface ConnectedApp { readonly id: string; readonly toolkit: string; readonly name: string; readonly status: AccountStatus }
export interface AppsList { readonly apps: readonly ConnectedApp[]; readonly usage: Readonly<Record<string, readonly string[]>> }
export type SignInState = 'pending' | 'connected' | 'failed' | 'expired'
export interface AppEntry {
  readonly toolkit: string
  readonly name: string
  readonly level: AppLevel
  readonly tools: number
  readonly capped: boolean
}
export interface BotAppsView {
  readonly apps: readonly AppEntry[]
  readonly offered: readonly AppLevel[]
  readonly asks: boolean
  readonly keyConfigured: boolean
  readonly roomWritesDeclined: boolean
}
