import { describe, expect, it } from 'vitest'

import { gatewayWsUrl } from '../src/hermes/gateway-client.js'

describe('gatewayWsUrl', () => {
  it('targets the Hermes /api/ws endpoint with an encoded token', () => {
    expect(gatewayWsUrl('http://127.0.0.1:9120', 'a/b+c=')).toBe('ws://127.0.0.1:9120/api/ws?token=a%2Fb%2Bc%3D')
  })

  it('keeps https → wss', () => {
    expect(gatewayWsUrl('https://hermes.local', 't')).toBe('wss://hermes.local/api/ws?token=t')
  })
})
