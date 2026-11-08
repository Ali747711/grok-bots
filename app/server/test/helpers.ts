import type { AppDeps } from '../src/app.js'
import { TicketStore } from '../src/auth/tickets.js'
import { loadConfig } from '../src/config.js'

export const HOST = '127.0.0.1:7070'
export const ORIGIN = 'http://127.0.0.1:7070'

/** Deterministic app dependencies for tests: fixed secrets and clock. */
export function makeDeps(nowMs = 1_000_000): AppDeps {
  return {
    config: loadConfig({ HOME: '/home/ali' }),
    secrets: { admin: Buffer.alloc(32, 1), cookie: Buffer.alloc(32, 7) },
    tickets: new TicketStore(),
    now: () => nowMs
  }
}
