import { describe, expect, it } from 'vitest'

import { RELAY_TEXT, filterToolsList, judge, parseBearer, parseUpstream } from '../src/connectors/relay.js'

const allowed = new Set(['GITHUB_GET_REPO'])
const call = (name?: unknown) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: name === undefined ? {} : { name } })

describe('judge', () => {
  it('forwards initialize, ping, notifications and JSON-RPC responses', () => {
    for (const m of [
      { jsonrpc: '2.0', id: 1, method: 'initialize' }, { jsonrpc: '2.0', id: 2, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 3, result: {} },
      { jsonrpc: '2.0', id: 4, error: { code: 1, message: 'x' } }, call('GITHUB_GET_REPO')
    ]) expect(judge(m, allowed)).toEqual({ kind: 'forward' })
  })

  it('filters tools/list and refuses a tools/call outside the allow list', () => {
    expect(judge({ id: 1, method: 'tools/list' }, allowed)).toEqual({ kind: 'filter' })
    expect(judge(call('GITHUB_DELETE_REPO'), allowed)).toEqual({ kind: 'refuse', code: -32602, message: RELAY_TEXT.notAllowed })
    expect(judge(call('toString'), allowed).kind).toBe('refuse')
  })

  it('refuses a batch array, a non-object, a missing tool name and an unknown method', () => {
    const invalid = { kind: 'refuse', code: -32600, message: 'Invalid request' }
    for (const m of [[], [call('GITHUB_GET_REPO')], null, 'x', 5, { id: 1 }, { method: 5 }]) expect(judge(m, allowed)).toEqual(invalid)
    expect(judge(call(), allowed)).toMatchObject({ kind: 'refuse', code: -32602 })
    expect(judge(call(7), allowed)).toMatchObject({ kind: 'refuse', code: -32602 })
    for (const method of ['resources/read', 'prompts/get']) {
      expect(judge({ id: 1, method }, allowed)).toEqual({ kind: 'refuse', code: -32601, message: RELAY_TEXT.noMethod })
    }
  })

  it('compares method names exactly', () => {
    for (const method of ['Tools/Call', 'tools/call ', 'tools/list ', 'Initialize', 'notifications']) {
      expect(judge({ id: 1, method, params: { name: 'GITHUB_GET_REPO' } }, allowed)).toMatchObject({ kind: 'refuse', code: -32601 })
    }
  })
})

describe('parseUpstream', () => {
  it('parses JSON and multi-event SSE bodies', () => {
    expect(parseUpstream('application/json', '{"id":1}')).toEqual([{ id: 1 }])
    expect(parseUpstream('application/json', 'nope')).toEqual([])
    const sse = 'event: message\ndata: {"id":1}\n\ndata: {"a":\ndata: 2}\r\n\r\n: ping\n\ndata: bad\n\n'
    expect(parseUpstream('text/event-stream; charset=utf-8', sse)).toEqual([{ id: 1 }, { a: 2 }])
  })
})

describe('filterToolsList', () => {
  it('drops tools outside the allow list and keeps annotations and nextCursor', () => {
    const tool = { name: 'GITHUB_GET_REPO', annotations: { readOnlyHint: true } }
    const out = filterToolsList({ jsonrpc: '2.0', id: 1, result: { nextCursor: 'c', tools: [tool, { name: 'OTHER' }, 5] } }, allowed)
    expect(out).toEqual({ jsonrpc: '2.0', id: 1, result: { nextCursor: 'c', tools: [tool] } })
    expect(filterToolsList({ id: 1, error: {} }, allowed)).toEqual({ id: 1, error: {} })
  })
})

describe('parseBearer', () => {
  it('parses only a well-formed Bearer header', () => {
    const t = 'a'.repeat(43)
    expect(parseBearer(`Bearer ${t}`)).toBe(t)
    for (const h of [undefined, '', t, `bearer ${t}`, `Bearer  ${t}`, `Bearer ${t} `, 'Bearer short', `Bearer ${'a'.repeat(129)}`, `Bearer ${t}!`]) {
      expect(parseBearer(h)).toBeNull()
    }
  })
})
