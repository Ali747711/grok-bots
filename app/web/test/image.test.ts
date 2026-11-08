import { afterEach, describe, expect, it, vi } from 'vitest'

import { MAX_PHOTO_BYTES, PhotoError, toAvatarPng } from '@/features/bots/image'

const file = (type: string, size = 10) => new File([new Uint8Array(size)], 'a', { type })

afterEach(() => vi.restoreAllMocks())

describe('toAvatarPng', () => {
  it('rejects a file over 15 MB', async () => {
    await expect(toAvatarPng(file('image/png', MAX_PHOTO_BYTES + 1))).rejects.toThrow(PhotoError)
  })

  it('rejects a file that is not png, jpeg, webp or gif', async () => {
    await expect(toAvatarPng(file('image/svg+xml'))).rejects.toThrow(/PNG, JPEG, WebP or GIF/)
    await expect(toAvatarPng(file('application/pdf'))).rejects.toBeInstanceOf(PhotoError)
  })

  it('draws a cover-cropped 256 px square and returns a PNG data url', async () => {
    const drawImage = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 512, height: 256, close: vi.fn() })))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA')
    await expect(toAvatarPng(file('image/jpeg'))).resolves.toBe('data:image/png;base64,AAAA')
    // 512x256 source: central 256x256 square drawn into 256x256.
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 128, 0, 256, 256, 0, 0, 256, 256)
    vi.unstubAllGlobals()
  })

  it('fails with a PhotoError when the image cannot be decoded', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('bad') }))
    await expect(toAvatarPng(file('image/png'))).rejects.toThrow(/read that image/)
    vi.unstubAllGlobals()
  })
})
