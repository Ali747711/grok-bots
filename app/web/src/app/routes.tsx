import { useEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'

import { Skeleton } from '@/components/ui/skeleton'
import { ChatView } from '@/features/chat/ChatView'
import { GroupChatView } from '@/features/groups/GroupChatView'
import { PanelBoundary } from '@/features/panel/PanelBoundary'
import { ProfilePage } from '@/features/profile/ProfilePage'
import type { CrewState } from '@/state/types'

import { type BotPanel, botUrl } from './panel-params'
import { readSidePanel } from './side-panel-memory'

const centered = 'grid flex-1 place-items-center text-sm text-muted-foreground'

export function Loading() {
  return (
    <div role="status" className="flex flex-1 flex-col gap-4 p-6">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-16 w-2/3" />
      <Skeleton className="ml-auto h-10 w-1/3" />
    </div>
  )
}

function NotFound() {
  return (
    <div className={`${centered} content-center justify-items-center gap-3`}>
      <p className="text-base font-medium text-foreground">Bot not found</p>
      <Link to="/" className="text-foreground underline underline-offset-2">Back to your bots</Link>
    </div>
  )
}

/** `/` opens the primary bot with the side panel the user last chose (none in a fresh browser, R4). */
export function HomeRedirect({ state }: { state: CrewState | null }) {
  const primary = state?.bots.find(b => b.isPrimary) ?? state?.bots[0]
  if (!primary) return <Loading />
  return <Navigate replace to={botUrl(primary.name, readSidePanel())} />
}

const MISSING_GRACE_MS = 3000

/** A bot just created can be opened before the state stream delivers it: wait for the next state (or the grace) before saying it is missing. */
function useMissingGrace(state: CrewState | null): boolean {
  const first = useRef(state)
  const [expired, setExpired] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setExpired(true), MISSING_GRACE_MS)
    return () => clearTimeout(timer)
  }, [])
  return !expired && state === first.current
}

interface BotRouteProps {
  state: CrewState | null
  crewConnected: boolean
  name: string
  panel: BotPanel | null
  /** A header button or Back: the panel to show next, or null for the conversation alone. */
  onPanel: (next: BotPanel | null) => void
}

/** A bot page's work area: the conversation, or the profile in its place for `?panel=profile`. */
export function BotRoute({ state, crewConnected, name, panel, onPanel }: BotRouteProps) {
  const waiting = useMissingGrace(state)
  if (!state) return <Loading />
  const bot = state.bots.find(b => b.name === name)
  if (!bot) return waiting ? <Loading /> : <NotFound />
  if (panel === 'profile') {
    return <PanelBoundary key={`profile-${bot.name}`}><ProfilePage key={bot.name} bot={bot} onBack={() => onPanel(null)} /></PanelBoundary>
  }
  return <ChatView key={bot.name} bot={bot} state={state} crewConnected={crewConnected} panel={panel} onPanel={onPanel} />
}

interface GroupRouteProps {
  state: CrewState | null
  crewConnected: boolean
  roomId: string
  panelOpen: boolean
  onPanel: () => void
}

/** A group just created can be opened before the state stream delivers it: same grace as a bot, then home. */
export function GroupRoute({ state, crewConnected, roomId, panelOpen, onPanel }: GroupRouteProps) {
  const waiting = useMissingGrace(state)
  if (!state) return <Loading />
  const group = state.groups?.rooms.find(r => r.id === roomId)
  if (!group) return waiting ? <Loading /> : <Navigate replace to="/" />
  return <GroupChatView key={group.id} state={state} crewConnected={crewConnected} roomId={group.id} panelOpen={panelOpen} onPanel={onPanel} />
}
