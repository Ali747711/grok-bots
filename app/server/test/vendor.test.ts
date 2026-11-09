import { appendFile, cp, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// @ts-expect-error -- plain .mjs script without type declarations
import { checkVendored } from '../../scripts/vendor-hermes.mjs'

const VENDOR_DIR = fileURLToPath(new URL('../src/vendor/hermes/', import.meta.url))
const PINNED = '2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19'

describe('vendored Hermes shared client', () => {
  it('pins the Hermes commit and includes the gateway client closure', async () => {
    const manifest = JSON.parse(await readFile(join(VENDOR_DIR, 'VENDORED_FROM.json'), 'utf8'))
    expect(manifest.commit).toBe(PINNED)
    expect(Object.keys(manifest.files)).toEqual(
      expect.arrayContaining(['json-rpc-gateway.ts', 'json-rpc-channel.ts', 'gateway-events.ts', 'gateway-contract.generated.ts'])
    )
    expect(Object.keys(manifest.files).some((f: string) => f.endsWith('.test.ts'))).toBe(false)
  })

  it('vendor:check passes on the committed tree', async () => {
    const result = await checkVendored(VENDOR_DIR)
    expect(result).toEqual({ ok: true, mismatches: [] })
  })

  it('vendor:check fails after a vendored byte changes', async () => {
    const copy = join(await mkdtemp(join(tmpdir(), 'crew-vendor-')), 'hermes')
    await cp(VENDOR_DIR, copy, { recursive: true })
    await appendFile(join(copy, 'json-rpc-channel.ts'), ' ')
    const result = await checkVendored(copy)
    expect(result.ok).toBe(false)
    expect(result.mismatches).toContain('json-rpc-channel.ts')
  })
})
