import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const SECRET_BYTES = 32

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code
}

async function readSecret(path: string): Promise<Buffer | null> {
  try {
    const value = await readFile(path)
    if (value.length !== SECRET_BYTES) {
      throw new Error(`secret file ${path} has ${value.length} bytes, expected ${SECRET_BYTES}`)
    }
    return value
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return null
    throw error
  }
}

/**
 * Return the 32-byte secret stored at `path`, creating it (0600, in a 0700 dir) on first use.
 * Survives restarts, which is what keeps Crew logins valid across reboots.
 */
export async function ensureSecret(path: string): Promise<Buffer> {
  const dir = dirname(path)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await chmod(dir, 0o700)

  const existing = await readSecret(path)
  if (existing) return existing

  const fresh = randomBytes(SECRET_BYTES)
  try {
    await writeFile(path, fresh, { mode: 0o600, flag: 'wx' })
    return fresh
  } catch (error) {
    // Another process created it between our read and write: use theirs.
    if (isNodeError(error, 'EEXIST')) {
      const raced = await readSecret(path)
      if (raced) return raced
    }
    throw error
  }
}
