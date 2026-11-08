/** Hermes closes the pixel socket with 1003 above this many bytes of cut text (facts 2.4). */
export const MAX_PASTE_BYTES = 256 * 1024

interface PasteTarget {
  viewOnly: boolean
  clipboardPasteFrom(text: string): void
}

/**
 * Forward an explicit user paste on `host` to the remote screen (noVNC core has no paste listener,
 * §11 R6). `viewOnly` is read live, so a paste after control changed hands is dropped, as Hermes's
 * own lease gate would. Returns the removal function.
 */
export function attachPaste(host: HTMLElement, client: PasteTarget): () => void {
  const onPaste = (event: Event): void => {
    if (client.viewOnly) return
    const text = (event as ClipboardEvent).clipboardData?.getData('text')
    if (!text || new TextEncoder().encode(text).length > MAX_PASTE_BYTES) return
    event.preventDefault()
    client.clipboardPasteFrom(text)
  }
  host.addEventListener('paste', onPaste)
  return () => host.removeEventListener('paste', onPaste)
}
