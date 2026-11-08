import { useState } from 'react'

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import type { BotView } from '@/state/types'

import { ControlBar } from './ControlBar'
import { ExpandDialog } from './ExpandDialog'
import { LiveView } from './LiveView'
import { ScreenError, ScreenLoading, ScreenMissing, ScreenOff } from './ScreenStates'
import { type UseScreen } from './use-screen'
import { type LiveHandle, useComputer } from './use-live-view'
import { UseScreenSwitch } from './UseScreenSwitch'

interface LiveBodyProps {
  readonly bot: BotView
  readonly screen: UseScreen
  readonly live: LiveHandle
}

function StopButton({ bot, screen }: Pick<LiveBodyProps, 'bot' | 'screen'>) {
  const [confirming, setConfirming] = useState(false)
  const held = screen.view.control !== 'bot'
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" disabled={held} onClick={() => setConfirming(true)}>Stop screen</Button>
      {held && <span className="text-xs text-muted-foreground">Hand back first</span>}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop {bot.title}'s screen? Its windows close.</AlertDialogTitle>
            <AlertDialogDescription>Anything the bot has open on its screen is closed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void screen.stop()}>Stop</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function LiveBody({ bot, screen, live }: LiveBodyProps) {
  const [expanded, setExpanded] = useState(false)
  const { view } = screen
  const inControl = view.control === 'you'
  return (
    <>
      {/* One viewer at a time: the panel's host is not rendered while Expand shows its own. */}
      {!expanded && <LiveView live={live} inControl={inControl} onExpand={() => setExpanded(true)} />}
      <ExpandDialog open={expanded} title={bot.title} live={live} inControl={inControl} onClose={() => setExpanded(false)} />
      <ControlBar connected={live.link === 'live'} control={view.control} botTitle={bot.title} onTake={() => void live.takeControl()} onHandBack={() => void live.handBack()} onForce={() => void live.forceHandBack()} />
      {view.notice && <p role="status" className="text-xs text-contrast-danger">{view.notice}</p>}
      <StopButton bot={bot} screen={screen} />
      <p className="text-xs text-muted-foreground">Taking control pauses the bot's screen tools. It doesn't lock the rest of its computer.</p>
    </>
  )
}

function Body({ bot, screen, live }: LiveBodyProps) {
  const { view } = screen
  const tryAgain = () => void (view.status?.running ? screen.refresh() : screen.start())
  switch (view.kind) {
    case 'loading':
      return <ScreenLoading />
    case 'starting':
      return <ScreenLoading label="Starting the screen" />
    case 'missing':
      return <ScreenMissing />
    case 'off':
      return <ScreenOff onStart={() => void screen.start()} />
    case 'low_memory':
      return <ScreenOff onStart={() => void screen.start()} message={view.message} />
    case 'error':
      return <ScreenError message={view.message ?? 'Something went wrong.'} onRetry={tryAgain} />
    case 'live':
      return <LiveBody bot={bot} screen={screen} live={live} />
  }
}

/**
 * The Computer tab. It owns the viewer (`useComputer`), so the Expand dialog can swap which host is
 * attached without handing control back; leaving the tab, closing the panel or switching bot unmounts
 * this component and the hook hands back (§11 C1).
 */
export function ComputerPanel({ bot }: { bot: BotView }) {
  const { screen, live } = useComputer(bot.name)
  const primary = bot.isPrimary || bot.name === 'default'
  return (
    <div className="flex flex-col gap-3 p-4">
      <Body bot={bot} screen={screen} live={live} />
      {!primary && screen.view.kind !== 'loading' && <UseScreenSwitch name={bot.name} title={bot.title} />}
    </div>
  )
}
