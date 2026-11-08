/** Hermes closes the pixel socket with 1003 above this many bytes of cut text (facts 2.4). */
export const MAX_PASTE_BYTES = 256 * 1024
const XK_V = 0x0076
const XK_CONTROL_L = 0xffe3
const XK_SHIFT_L = 0xffe1
/** noVNC maps Cmd (Meta) to Alt_L on the remote, so a Cmd+V would arrive as Alt+v. */
const XK_ALT_L = 0xffe9
export const CLIPBOARD_DENIED = 'Allow clipboard access to paste into the screen'
export const PASTE_TOO_LARGE = 'Too much text to paste (256 KiB limit)'

interface PasteTarget {
  viewOnly: boolean
  clipboardPasteFrom(text: string): void
  sendKey(keysym: number, code: string | null, down?: boolean): void
}

const tooLarge = (text: string): boolean => new TextEncoder().encode(text).length > MAX_PASTE_BYTES

/**
 * Pasting into the remote screen (§11 R6). noVNC's keyboard handler `preventDefault`s every keydown,
 * Ctrl+V included, so the browser never fires `paste` for the shortcut. A capture-phase keydown on the
 * host (the canvas's parent) runs first, reads the clipboard itself, hands the text to the remote
 * clipboard and then sends `v` (Ctrl is already down remotely). A native `paste` (menu paste) still works.
 * `viewOnly` is read live, so nothing is sent unless we hold control. Never throws.
 */
export function attachPaste(host: HTMLElement, client: PasteTarget, notify: (message: string | null) => void): () => void {
  const forward = (text: string): boolean => {
    if (tooLarge(text)) {
      notify(PASTE_TOO_LARGE)
      return false
    }
    notify(null)
    client.clipboardPasteFrom(text)
    return true
  }
  const onPaste = (event: Event): void => {
    const text = (event as ClipboardEvent).clipboardData?.getData('text')
    if (client.viewOnly || !text) return
    if (!tooLarge(text)) event.preventDefault()
    forward(text)
  }
  // The user may have released Ctrl while the clipboard read (or its permission prompt) was pending, so
  // the chord is sent explicitly instead of relying on the physical key still being down.
  // Shift is kept: Ctrl+Shift+V is the paste shortcut of terminals, where plain Ctrl+V means "quote next key".
  const pasteFromClipboard = (text: string, viaMeta: boolean, viaShift: boolean): void => {
    if (client.viewOnly || !text || !forward(text)) return
    if (viaMeta) client.sendKey(XK_ALT_L, 'MetaLeft', false)
    client.sendKey(XK_CONTROL_L, 'ControlLeft', true)
    if (viaShift) client.sendKey(XK_SHIFT_L, 'ShiftLeft', true)
    client.sendKey(XK_V, 'KeyV')
    if (viaShift) client.sendKey(XK_SHIFT_L, 'ShiftLeft', false)
    client.sendKey(XK_CONTROL_L, 'ControlLeft', false)
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    // `code` covers layouts where the V key does not produce a Latin "v".
    const isV = event.key.toLowerCase() === 'v' || event.code === 'KeyV'
    if (client.viewOnly || !(event.ctrlKey || event.metaKey) || !isV) return
    event.preventDefault()
    event.stopPropagation()
    if (!navigator.clipboard) return notify(CLIPBOARD_DENIED)
    const { metaKey, shiftKey } = event
    navigator.clipboard.readText().then(text => pasteFromClipboard(text, metaKey, shiftKey), () => notify(CLIPBOARD_DENIED))
  }
  host.addEventListener('paste', onPaste)
  host.addEventListener('keydown', onKeyDown, true)
  return () => {
    host.removeEventListener('paste', onPaste)
    host.removeEventListener('keydown', onKeyDown, true)
  }
}
