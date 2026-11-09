// @novnc/novnc 1.7.0 ships no types. Only what Crew uses is declared.
declare module '@novnc/novnc' {
  export interface RfbOptions {
    shared?: boolean
    credentials?: { password?: string }
    wsProtocols?: string[]
  }
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, urlOrChannel: string | WebSocket, options?: RfbOptions)
    scaleViewport: boolean
    resizeSession: boolean
    clipViewport: boolean
    focusOnClick: boolean
    viewOnly: boolean
    qualityLevel: number
    compressionLevel: number
    background: string
    disconnect(): void
    focus(): void
    blur(): void
    clipboardPasteFrom(text: string): void
    sendKey(keysym: number, code: string | null, down?: boolean): void
  }
}
