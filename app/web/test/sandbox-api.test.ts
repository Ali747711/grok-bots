import { afterEach, describe, expect, it, vi } from 'vitest'

import { CrewApiError } from '@/lib/crew-json'
import {
  PULL_ERROR_TEXT, checkReason, getImage, getSandbox, progressText, pullImage, resetSandbox, sandboxErrorText, setSandbox
} from '@/features/bots/sandbox-api'

const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
const err = (status: number, error?: string) => new CrewApiError(status, error ? { error } : null)

afterEach(() => vi.unstubAllGlobals())

describe('sandbox api calls', () => {
  it('uses the five paths and methods', async () => {
    const fn = vi.fn((_url: string, _init?: RequestInit) => reply({}))
    vi.stubGlobal('fetch', fn)
    await getSandbox('a b')
    await setSandbox('dev', true)
    await resetSandbox('dev')
    await getImage()
    await pullImage()
    const seen = fn.mock.calls.map(([u, i]) => `${i?.method ?? 'GET'} ${u}`)
    expect(seen).toEqual([
      'GET /crew/bots/a%20b/sandbox', 'PUT /crew/bots/dev/sandbox', 'POST /crew/bots/dev/sandbox/reset',
      'GET /crew/sandbox/image', 'POST /crew/sandbox/image/pull'
    ])
    expect(JSON.parse(String(fn.mock.calls[1]?.[1]?.body))).toEqual({ on: true })
  })

  it('accepts 202 from the pull route', async () => {
    vi.stubGlobal('fetch', vi.fn(() => reply({ pulling: true }, 202)))
    await expect(pullImage()).resolves.toMatchObject({ pulling: true })
  })
})

describe('error text', () => {
  it('maps switch errors', () => {
    expect(sandboxErrorText(err(409, 'docker_unavailable'))).toBe("Docker isn't available on this computer")
    expect(sandboxErrorText(err(409, 'image_missing'))).toBe("The sandbox image isn't downloaded")
    expect(sandboxErrorText(err(503, 'hermes_offline'))).toBe('Hermes is offline')
    expect(sandboxErrorText(err(502))).toBe("Couldn't change the sandbox. Try again.")
    expect(sandboxErrorText(new Error('x'))).toBe("Couldn't change the sandbox. Try again.")
  })

  it('maps check reasons (R11)', () => {
    expect(checkReason(err(503))).toBe('Hermes is offline')
    expect(checkReason(err(502, 'bad_image_name'))).toBe("the image name in this bot's settings isn't valid")
    expect(checkReason(err(502, 'other'))).toBe("Hermes didn't answer")
    expect(checkReason(new Error('x'))).toBe("Hermes didn't answer")
  })

  it('has a text for each pull error', () => {
    expect(PULL_ERROR_TEXT).toEqual({
      no_space: "There isn't enough disk space for the sandbox image.",
      network: "Couldn't reach Docker Hub. Check the internet connection.",
      failed: 'The download stopped.'
    })
  })
})

describe('progressText', () => {
  it('says starting for null and for no layers', () => {
    expect(progressText(null)).toBe('Starting the download…')
    expect(progressText({ layersDone: 0, layersTotal: 0, bytesDone: null, bytesTotal: null })).toBe('Starting the download…')
  })
  it('counts parts', () => {
    expect(progressText({ layersDone: 2, layersTotal: 5, bytesDone: null, bytesTotal: null })).toBe('Downloading… 2 of 5 parts')
  })
  it('prefers bytes', () => {
    expect(progressText({ layersDone: 2, layersTotal: 5, bytesDone: 312_400_000, bytesTotal: 1_200_000_000 })).toBe('Downloading… 312 MB of 1200 MB')
  })
})
