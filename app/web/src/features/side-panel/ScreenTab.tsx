import { Maximize2 } from 'lucide-react'
import { useState } from 'react'

import { IconButton } from '@/components/console/icon-button'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useBotChat } from '@/features/chat/chat-session-context'
import { ControlBar } from '@/features/computer/ControlBar'
import { ExpandDialog } from '@/features/computer/ExpandDialog'
import { LiveView } from '@/features/computer/LiveView'
import { ScreenError, ScreenLoading, ScreenMissing, ScreenOff } from '@/features/computer/ScreenStates'
import type { ScreenControl } from '@/features/computer/screen-state'
import { UseScreenSwitch } from '@/features/computer/UseScreenSwitch'
import type { BotView } from '@/state/types'

import { type ComputerContextValue, useComputerContext } from './ComputerProvider'
import { NowStrip } from './NowStrip'
import { RecentActions } from './RecentActions'
import { nowStep, recentActions } from './recent-actions'

interface PartProps extends ComputerContextValue {
  readonly bot: BotView
}

/** Why Stop is off while a person holds the screen. */
const STOP_BLOCKED: Record<ScreenControl, string | null> = { bot: null, you: 'Hand back first', someone: 'Someone is in control' }

function StopButton({ bot, screen }: Pick<PartProps, 'bot' | 'screen'>) {
  const [confirming, setConfirming] = useState(false)
  return (
    <>
      <Button variant="outline" disabled={screen.view.control !== 'bot'} onClick={() => setConfirming(true)}>Stop screen</Button>
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
    </>
  )
}

/** The running screen in its well, with the controls row under it. */
function LiveBody({ bot, screen, live }: PartProps) {
  const [expanded, setExpanded] = useState(false)
  const { view } = screen
  const inControl = view.control === 'you'
  const stopBlocked = STOP_BLOCKED[view.control]
  return (
    <>
      <div className="flex shrink-0 flex-col items-center gap-3 rounded-2xl bg-background p-3">
        {/* One viewer at a time: the panel's host is not rendered while Expand shows its own. */}
        {expanded ? <div aria-hidden="true" className="aspect-video w-full rounded-xl border border-border bg-raised" /> : <LiveView live={live} inControl={inControl} />}
        <ExpandDialog open={expanded} title={bot.title} live={live} inControl={inControl} onClose={() => setExpanded(false)} />
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          <ControlBar connected={live.link === 'live'} control={view.control} botTitle={bot.title} onTake={() => void live.takeControl()} onHandBack={() => void live.handBack()} onForce={() => void live.forceHandBack()} />
          <IconButton label="Expand the screen" className="size-9 border-border text-foreground" onClick={() => setExpanded(true)}><Maximize2 /></IconButton>
          <StopButton bot={bot} screen={screen} />
        </div>
        {stopBlocked && <p className="text-xs font-medium text-muted-foreground">{stopBlocked}</p>}
        <p className="text-center text-xs font-medium text-muted-foreground">Taking control pauses the bot's screen tools. It doesn't lock the rest of its computer.</p>
      </div>
      {/* On the panel, not in the well: the red text is only readable on the shell. */}
      {view.notice && <p role="status" className="px-3 text-xs font-medium text-destructive">{view.notice}</p>}
    </>
  )
}

function Body({ bot, screen, live }: PartProps) {
  const { view } = screen
  // No status yet: re-read it. A running screen: re-read. Only a stopped one starts.
  const tryAgain = () => void (!view.status || view.status.running ? screen.refresh() : screen.start())
  const unsupported = view.status !== null && !view.status.supported
  switch (view.kind) {
    case 'loading':
      return <ScreenLoading />
    case 'starting':
      return <ScreenLoading label="Starting the screen" />
    case 'missing':
      return <ScreenMissing command={view.status?.install_command ?? null} />
    case 'off':
      return <ScreenOff title={bot.title} onStart={screen.start} />
    case 'low_memory':
      return <ScreenOff title={bot.title} onStart={screen.start} blocker={view.message} onCheck={() => void screen.refresh()} />
    case 'error':
      return <ScreenError message={view.message ?? 'Something went wrong.'} onRetry={unsupported ? undefined : tryAgain} />
    case 'live':
      return <LiveBody bot={bot} screen={screen} live={live} />
  }
}

/**
 * The side panel's Screen tab: the bot's screen in whatever state it is in, what the bot is doing
 * now, and its recent actions (the open chat's tool steps). The viewer itself lives in
 * `ComputerProvider` above, so the Expand dialog can swap which host is attached without handing
 * control back, and leaving the tab unmounts it (§6.3).
 */
export function ScreenTab({ bot }: { bot: BotView }) {
  const { screen, live } = useComputerContext()
  const { items } = useBotChat(bot.name)
  const primary = bot.isPrimary || bot.name === 'default'
  const { kind } = screen.view
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-2 pb-2">
      <Body bot={bot} screen={screen} live={live} />
      {!primary && kind !== 'loading' && kind !== 'missing' && <div className="shrink-0 px-3 pb-1"><UseScreenSwitch name={bot.name} title={bot.title} /></div>}
      <NowStrip step={nowStep(items)} />
      <RecentActions title={bot.title} actions={recentActions(items)} />
    </div>
  )
}
