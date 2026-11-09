import { readFile } from 'node:fs/promises'

export type HermesTokenState = 'ok' | 'signed_out'

/**
 * The Hermes Webapp session token, read from its user-only file. Hermes rotates the file on Webapp
 * sign-out or when it finds it invalid, so callers re-read once after a 401 instead of looping.
 */
export class HermesToken {
  private cached: string | null = null
  private current: HermesTokenState = 'ok'

  constructor(private readonly file: string) {}

  get state(): HermesTokenState {
    return this.current
  }

  async get(): Promise<string> {
    return this.cached ?? this.refresh()
  }

  async refresh(): Promise<string> {
    const value = (await readFile(this.file, 'utf8')).trim()
    if (!value) throw new Error('Hermes token file is empty')
    this.cached = value
    return value
  }

  markOk(): void {
    this.current = 'ok'
  }

  markSignedOut(): void {
    this.current = 'signed_out'
  }
}
