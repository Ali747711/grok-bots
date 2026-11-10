import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { log } from '../log.js'

/** Printable ASCII without spaces, 8 to 256 characters. */
export const KEY_RE = /^[\x21-\x7e]{8,256}$/

/** The Composio API key in its own 0600 file (tmp, chmod, rename). Nothing else ever stores it. */
export class KeyStore {
  private constructor(
    private readonly file: string,
    private key: string | null
  ) {}

  static async load(file: string): Promise<KeyStore> {
    try {
      const text = (await readFile(file, 'utf8')).trim()
      return new KeyStore(file, text === '' ? null : text)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      // Only the code is logged: the path and the message could name the file's folder.
      if (code !== 'ENOENT') log.error('composio key unreadable', { code })
      return new KeyStore(file, null)
    }
  }

  get(): string | null {
    return this.key
  }

  async save(key: string): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
    const tmp = `${this.file}.tmp`
    try {
      await writeFile(tmp, `${key}\n`, { mode: 0o600 })
      await chmod(tmp, 0o600)
      await rename(tmp, this.file)
    } catch (err) {
      // A failed save must not leave a key copy behind.
      await rm(tmp, { force: true }).catch(() => undefined)
      throw err
    }
    this.key = key
  }

  async remove(): Promise<void> {
    await rm(`${this.file}.tmp`, { force: true })
    await rm(this.file, { force: true })
    this.key = null
  }
}
