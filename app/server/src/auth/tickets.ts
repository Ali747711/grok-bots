import { randomBytes } from 'node:crypto'

export const TICKET_TTL_MS = 60_000

/** One-use launch tickets for `crew login`. In memory: a restart invalidates unredeemed links, which is fine. */
export class TicketStore {
  private readonly minted = new Map<string, number>()

  mint(nowMs: number): string {
    this.prune(nowMs)
    const ticket = randomBytes(32).toString('base64url')
    this.minted.set(ticket, nowMs)
    return ticket
  }

  /** True exactly once per unexpired ticket. Synchronous, so concurrent requests cannot both win. */
  redeem(ticket: string, nowMs: number): boolean {
    const mintedAt = this.minted.get(ticket)
    if (mintedAt === undefined) return false
    this.minted.delete(ticket)
    return nowMs - mintedAt <= TICKET_TTL_MS
  }

  private prune(nowMs: number): void {
    for (const [ticket, mintedAt] of this.minted) {
      if (nowMs - mintedAt > TICKET_TTL_MS) this.minted.delete(ticket)
    }
  }
}
