import { describe, expect, it } from 'vitest'

import {
  SERVER_NAME, TOKEN_ENV, addAppsServer, appsServer, reloadMcp, removeAppsServer, setAppsServerEnabled
} from '../src/connectors/hermes-mcp.js'
import { HermesRestError, HermesRpcError } from '../src/hermes/errors.js'
import { FakeRest, FakeRpc } from './fake-rpc.js'

function setup() {
  const rpc = new FakeRpc()
  const rest = new FakeRest()
  return { rpc, rest, h: { rpc: rpc.call, rest: rest as never } }
}

describe('hermes-mcp', () => {
  it('adds crew_apps with trust untrusted, enabled, the relay URL, a per-profile identity header and the token only as bearer_token', async () => {
    const { rpc, h } = setup()
    rpc.handlers.set('mcp.servers.add', () => ({ ok: true }))
    await addAppsServer(h, 'scout', 'http://127.0.0.1:7070/mcp/scout', 'tok_secret')
    expect(SERVER_NAME).toBe('crew_apps')
    expect(TOKEN_ENV).toBe('MCP_CREW_APPS_API_KEY')
    expect(rpc.calls).toEqual([{
      method: 'mcp.servers.add',
      params: {
        profile: 'scout', name: 'crew_apps',
        config: {
          url: 'http://127.0.0.1:7070/mcp/scout', trust: 'untrusted', enabled: true,
          identity_header: { name: 'X-Crew-Bot', value_from: 'profile' }
        },
        bearer_token: 'tok_secret'
      }
    }])
    await addAppsServer(h, 'scout', 'http://127.0.0.1:7070/mcp/scout', 'tok_secret', false)
    expect(rpc.of('mcp.servers.add')[1]?.params.config).toMatchObject({ enabled: false, identity_header: { name: 'X-Crew-Bot', value_from: 'profile' } })
    expect(JSON.stringify(rpc.params('mcp.servers.add')?.config)).not.toContain('tok_secret')
  })

  it('toggles enabled through REST and finds the server in the list', async () => {
    const { rest, h } = setup()
    rest.routes.set('GET /api/mcp/servers', () => ({ servers: [{ name: 'other', enabled: true }, { name: 'crew_apps', enabled: false }] }))
    rest.routes.set('PUT /api/mcp/servers/crew_apps/enabled', () => ({ ok: true }))
    expect(await appsServer(h, 'scout')).toEqual({ enabled: false })
    await setAppsServerEnabled(h, 'scout', true)
    expect(rest.requests[0]).toMatchObject({ method: 'GET', query: { profile: 'scout' } })
    expect(rest.requests[1]).toMatchObject({ method: 'PUT', query: { profile: 'scout' }, body: { enabled: true, profile: 'scout' } })
    rest.routes.set('GET /api/mcp/servers', () => ({ servers: [] }))
    expect(await appsServer(h, 'scout')).toBeNull()
  })

  it('removes the server and the token env var, ignoring 404 for either', async () => {
    const { rest, h } = setup()
    rest.routes.set('DELETE /api/mcp/servers/crew_apps', () => { throw new HermesRestError(404, 'gone') })
    rest.routes.set('DELETE /api/env', () => { throw new HermesRestError(404, 'gone') })
    await removeAppsServer(h, 'scout')
    expect(rest.requests).toMatchObject([
      { method: 'DELETE', path: '/api/mcp/servers/crew_apps', query: { profile: 'scout' } },
      { method: 'DELETE', path: '/api/env', body: { key: 'MCP_CREW_APPS_API_KEY', profile: 'scout' } }
    ])
    rest.routes.set('DELETE /api/env', () => { throw new HermesRestError(500, 'boom') })
    await expect(removeAppsServer(h, 'scout')).rejects.toBeInstanceOf(HermesRestError)
  })

  it('reloads MCP for the bot and its canonical chat and never rejects', async () => {
    const { rpc, h } = setup()
    rpc.handlers.set('reload.mcp', () => ({ status: 'reloaded' }))
    rpc.handlers.set('profiles.list', () => ({ profiles: [
      { name: 'other', canonical_session: { id: 'x' } },
      { name: 'scout', canonical_session: { id: 'live', resolved_id: 'resolved' } }
    ] }))
    await reloadMcp(h, 'scout', false)
    await reloadMcp(h, 'scout', true)
    expect(rpc.of('reload.mcp').map(c => c.params)).toEqual([
      { profile: 'scout', confirm: true },
      { profile: 'scout', confirm: true, session_id: 'resolved' }
    ])
    rpc.fail('reload.mcp', new HermesRpcError(-1, 'busy'))
    await expect(reloadMcp(h, 'scout', true)).resolves.toBeUndefined()
    rpc.fail('profiles.list', new Error('down'))
    await expect(reloadMcp(h, 'scout', true)).resolves.toBeUndefined()
  })
})
