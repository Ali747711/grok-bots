import { Component, type ErrorInfo, type ReactNode } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

interface PanelBoundaryProps {
  children: ReactNode
  /** What the Reload button does; defaults to reloading the page. */
  onReload?: () => void
}

/** Keeps a render failure inside the panel from blanking the whole app. */
export class PanelBoundary extends Component<PanelBoundaryProps, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // The message below is all the user needs; React already reports the error to the console in development.
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertDescription className="flex flex-col items-start gap-3">
            <p>Something went wrong in this panel</p>
            <Button type="button" size="sm" onClick={this.props.onReload ?? (() => window.location.reload())}>Reload</Button>
          </AlertDescription>
        </Alert>
      </div>
    )
  }
}
