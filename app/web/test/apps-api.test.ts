import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  appsErrorText, connect, disconnect, getBotApps, getKey, listApps, pollConnect, removeKey, saveKey, searchToolkits, setBotApps
} from '@/features/apps/apps-api'
import { CrewApiError } from '@/lib/crew-json'

const err = (status: number, error?: string) => new CrewApiError(status, error ? { error } : null)

afterEach(() => vi.unstubAllGlobals())

describe('apps api calls', () => {
  it('uses the ten paths and methods', async () => {
    const fn = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(new Response('{}')))
    vi.stubGlobal('fetch', fn)
    await getKey()
    await saveKey('ak_test_key_123')
    await removeKey().catch(() => undefined)
    await listApps()
    await searchToolkits('git hub')
    await connect('github')
    await pollConnect('ca_1')
    await disconnect('ca_1').catch(() => undefined)
    await getBotApps('a b')
    await setBotApps('dev', { github: 'read' })
    expect(fn.mock.calls.map(([u, i]) => `${i?.method ?? 'GET'} ${u}`)).toEqual([
      'GET /crew/connectors/key', 'PUT /crew/connectors/key', 'DELETE /crew/connectors/key',
      'GET /crew/connectors/apps', 'GET /crew/connectors/toolkits?search=git%20hub',
      'POST /crew/connectors/connect', 'GET /crew/connectors/connect/ca_1', 'DELETE /crew/connectors/apps/ca_1',
      'GET /crew/bots/a%20b/apps', 'PUT /crew/bots/dev/apps'
    ])
    const body = (i: number) => JSON.parse(String(fn.mock.calls[i]?.[1]?.body))
    expect(body(1)).toEqual({ key: 'ak_test_key_123' })
    expect(body(5)).toEqual({ toolkit: 'github' })
    expect(body(9)).toEqual({ github: 'read' })
  })
})

describe('appsErrorText', () => {
  it('maps each code', () => {
    expect(appsErrorText(err(409, 'no_key'))).toBe('Set the key in Settings')
    expect(appsErrorText(err(409, 'key_rejected'))).toBe('Key not accepted')
    expect(appsErrorText(err(502, 'composio_unavailable'))).toBe("Couldn't reach Composio")
    expect(appsErrorText(err(409, 'level_unavailable'))).toBe("This bot doesn't ask before actions, so it can only read in apps.")
    expect(appsErrorText(err(409, 'app_unsupported'), 'Foo')).toBe("Crew can't connect Foo yet.")
    expect(appsErrorText(err(503, 'hermes_offline'))).toBe('Hermes is offline')
    expect(appsErrorText(err(502, 'apps_failed'))).toBe("Couldn't change the apps. Try again.")
    expect(appsErrorText(new Error('x'))).toBe("Couldn't change the apps. Try again.")
  })
})
