import { useEffect } from 'react'

export type CrewDialog = 'apps' | 'settings'

const EVENT = 'crew:open-dialog'

/** R15: any panel asks the roster footer to open a dialog. */
export function openDialog(which: CrewDialog): void {
  window.dispatchEvent(new CustomEvent<CrewDialog>(EVENT, { detail: which }))
}

export function useDialogRequests(onOpen: (which: CrewDialog) => void): void {
  useEffect(() => {
    const handler = (e: Event) => {
      const which = (e as CustomEvent<unknown>).detail
      if (which === 'apps' || which === 'settings') onOpen(which)
    }
    window.addEventListener(EVENT, handler)
    return () => window.removeEventListener(EVENT, handler)
  }, [onOpen])
}

const KEY_EVENT = 'crew:key-changed'

/** The Composio key was saved or removed: panels that read apps load again. */
export function notifyKeyChanged(): void {
  window.dispatchEvent(new CustomEvent(KEY_EVENT))
}

export function useKeyChanged(onChange: () => void): void {
  useEffect(() => {
    window.addEventListener(KEY_EVENT, onChange)
    return () => window.removeEventListener(KEY_EVENT, onChange)
  }, [onChange])
}
