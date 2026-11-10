import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, matchPath, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { Skeleton } from '@/components/ui/skeleton'
import { NewBotDialog } from '@/features/bots/NewBotDialog'
import { ChatView } from '@/features/chat/ChatView'
import { GroupChatView } from '@/features/groups/GroupChatView'
import { GroupPanel } from '@/features/groups/GroupPanel'
import { NewGroupDialog } from '@/features/groups/NewGroupDialog'
import { NeedsYouPage } from '@/features/needs-you/NeedsYouPage'
import { BotPanel, isPanelTab, type PanelTab } from '@/features/panel/BotPanel'
import { PanelBoundary } from '@/features/panel/PanelBoundary'
import { Sidebar } from '@/features/roster/Sidebar'
import { Shell } from '@/layout/Shell'
import type { CrewState } from '@/state/types'
import { useCrewState } from '@/state/use-crew-state'

const centered = 'grid flex-1 place-items-center text-sm text-muted-foreground'

function Loading() {
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

function HomeRedirect({ state }: { state: CrewState | null }) {
  const primary = state?.bots.find(b => b.isPrimary) ?? state?.bots[0]
  if (!primary) return <Loading />
  return <Navigate replace to={`/bots/${encodeURIComponent(primary.name)}`} />
}

interface BotRouteProps {
  state: CrewState | null
  crewConnected: boolean
  name: string
  panel: PanelTab | null
  onPanel: (tab: PanelTab) => void
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

function BotRoute({ state, crewConnected, name, panel, onPanel }: BotRouteProps) {
  const waiting = useMissingGrace(state)
  if (!state) return <Loading />
  const bot = state.bots.find(b => b.name === name)
  if (!bot) return waiting ? <Loading /> : <NotFound />
  return <ChatView key={bot.name} bot={bot} state={state} crewConnected={crewConnected} panel={panel} onPanel={onPanel} />
}

/** A group just created can be opened before the state stream delivers it: same grace as a bot, then home. */
function GroupRoute({ state, crewConnected, roomId }: { state: CrewState | null; crewConnected: boolean; roomId: string }) {
  const [params, setParams] = useSearchParams()
  const panelOpen = params.get('panel') === 'group'
  const onPanel = () => setParams(prev => {
    const next = new URLSearchParams(prev)
    if (next.get('panel') === 'group') next.delete('panel')
    else next.set('panel', 'group')
    return next
  })
  const waiting = useMissingGrace(state)
  if (!state) return <Loading />
  const group = state.groups?.rooms.find(r => r.id === roomId)
  if (!group) return waiting ? <Loading /> : <Navigate replace to="/" />
  return <GroupChatView key={group.id} state={state} crewConnected={crewConnected} roomId={group.id} panelOpen={panelOpen} onPanel={onPanel} />
}

/** Go home when the open bot was in the roster and is gone (deleted in another app); never for one that has not appeared yet. */
function useLeaveDeletedBot(state: CrewState | null, selected: string | null, goHome: () => void): void {
  const seen = useRef(new Set<string>())
  useEffect(() => {
    if (!state) return
    const present = new Set(state.bots.map(b => b.name))
    for (const name of present) seen.current.add(name)
    if (selected && seen.current.has(selected) && !present.has(selected)) {
      seen.current.delete(selected)
      goHome()
    }
  }, [state, selected, goHome])
}

/** The open panel tab lives in the `?panel=` search param so a reload keeps it. */
function usePanelParams(selected: string | null, selectedGroupId: string | null) {
  const [params, setParams] = useSearchParams()
  const requested = params.get('panel')
  const edit = (change: (next: URLSearchParams) => void) => setParams(prev => {
    const next = new URLSearchParams(prev)
    change(next)
    return next
  })
  return {
    panel: selected && isPanelTab(requested) ? requested : null,
    groupPanel: selectedGroupId !== null && requested === 'group',
    // Clicking the open tab closes the panel.
    togglePanel: (tab: PanelTab) => edit(next => (next.get('panel') === tab ? next.delete('panel') : next.set('panel', tab))),
    selectPanel: (tab: PanelTab) => edit(next => next.set('panel', tab)),
    closePanel: () => edit(next => next.delete('panel'))
  }
}

export default function App() {
  const { state, connected } = useCrewState()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [newBotOpen, setNewBotOpen] = useState(false)
  const [newGroupOpen, setNewGroupOpen] = useState(false)
  const goHome = useCallback(() => navigate('/', { replace: true }), [navigate])
  const selected = matchPath('/bots/:name', pathname)?.params.name ?? null
  const selectedGroupId = matchPath('/groups/:roomId', pathname)?.params.roomId ?? null
  const seatable = new Set(state?.groups?.seatable ?? [])
  const groupBots = (state?.bots ?? []).filter(b => !b.hidden && seatable.has(b.name))

  useLeaveDeletedBot(state, selected, goHome)
  const { panel, groupPanel, togglePanel, selectPanel, closePanel } = usePanelParams(selected, selectedGroupId)
  const panelGroup = groupPanel ? state?.groups?.rooms.find(r => r.id === selectedGroupId) : undefined
  const panelBot = panel ? state?.bots.find(b => b.name === selected) : undefined

  return (
    <>
      <Shell
        sidebar={
          <Sidebar
            state={state}
            crewConnected={connected}
            selected={selected}
            onSelect={name => navigate({ pathname: `/bots/${encodeURIComponent(name)}`, ...(panel ? { search: `?panel=${panel}` } : {}) })}
            needsYouActive={matchPath('/needs-you', pathname) !== null}
            onNeedsYou={() => navigate('/needs-you')}
            onNewBot={() => setNewBotOpen(true)}
            selectedGroupId={selectedGroupId}
            onSelectGroup={roomId => navigate(`/groups/${encodeURIComponent(roomId)}`)}
            onNewGroup={() => setNewGroupOpen(true)}
          />
        }
        main={
          <Routes>
            <Route path="/" element={<HomeRedirect state={state} />} />
            <Route path="/bots/:name" element={<BotRoute key={selected} state={state} crewConnected={connected} name={selected ?? ''} panel={panel} onPanel={togglePanel} />} />
            <Route path="/groups/:roomId" element={<GroupRoute key={selectedGroupId} state={state} crewConnected={connected} roomId={selectedGroupId ?? ''} />} />
            <Route path="/needs-you" element={state ? <NeedsYouPage state={state} crewConnected={connected} /> : <Loading />} />
            <Route path="*" element={<Navigate replace to="/" />} />
          </Routes>
        }
        panel={panelGroup ? (
          <PanelBoundary key={`group-${panelGroup.id}`}>
            <GroupPanel view={panelGroup} bots={state?.bots ?? []} stale={state === null || state.hermes !== 'connected' || !connected} onDeleted={() => navigate('/', { replace: true })} onClose={closePanel} />
          </PanelBoundary>
        ) : panelBot && panel ? <PanelBoundary key={`${panelBot.name}-${panel}`}><BotPanel bot={panelBot} tab={panel} onTab={selectPanel} onClose={closePanel} /></PanelBoundary> : null}
        panelOpen={panelBot !== undefined || panelGroup !== undefined}
      />
      <NewGroupDialog open={newGroupOpen} onOpenChange={setNewGroupOpen} bots={groupBots} onCreated={roomId => navigate(`/groups/${encodeURIComponent(roomId)}`)} />
      <NewBotDialog open={newBotOpen} onOpenChange={setNewBotOpen} onCreated={name => navigate(`/bots/${encodeURIComponent(name)}`)} />
    </>
  )
}
