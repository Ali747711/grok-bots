export const MAX_PHOTO_BYTES = 15 * 1024 * 1024
export const AVATAR_SIZE = 256
const ACCEPTED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** A photo the user picked that Crew will not use; the message is safe to show. */
export class PhotoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PhotoError'
  }
}

/** Cover-crop `bitmap` into a 256 px square and return it as a PNG data url. */
function drawSquare(bitmap: ImageBitmap): string {
  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_SIZE
  canvas.height = AVATAR_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new PhotoError('Could not read that image')
  const side = Math.min(bitmap.width, bitmap.height)
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
  return canvas.toDataURL('image/png')
}

/** Validate and downscale a picked image to a 256 px PNG data url (Hermes accepts at most 2 MB decoded). */
export async function toAvatarPng(file: File): Promise<string> {
  if (!ACCEPTED.has(file.type)) throw new PhotoError('Use a PNG, JPEG, WebP or GIF image')
  if (file.size > MAX_PHOTO_BYTES) throw new PhotoError('That photo is over 15 MB')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new PhotoError('Could not read that image')
  }
  try {
    return drawSquare(bitmap)
  } finally {
    bitmap.close()
  }
}
