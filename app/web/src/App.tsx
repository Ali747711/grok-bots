import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, matchPath, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { Skeleton } from '@/components/ui/skeleton'
import { NewBotDialog } from '@/features/bots/NewBotDialog'
import { ChatView } from '@/features/chat/ChatView'
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
      <Link to="/" className="text-sky-ink underline underline-offset-2">Back to your bots</Link>
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

function BotRoute({ state, crewConnected, name, panel, onPanel }: BotRouteProps) {
  if (!state) return <Loading />
  const bot = state.bots.find(b => b.name === name)
  if (!bot) return <NotFound />
  return <ChatView key={bot.name} bot={bot} state={state} crewConnected={crewConnected} panel={panel} onPanel={onPanel} />
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
function usePanelParams(selected: string | null) {
  const [params, setParams] = useSearchParams()
  const requested = params.get('panel')
  const edit = (change: (next: URLSearchParams) => void) => setParams(prev => {
    const next = new URLSearchParams(prev)
    change(next)
    return next
  })
  return {
    panel: selected && isPanelTab(requested) ? requested : null,
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
  const goHome = useCallback(() => navigate('/', { replace: true }), [navigate])
  const selected = matchPath('/bots/:name', pathname)?.params.name ?? null

  useLeaveDeletedBot(state, selected, goHome)
  const { panel, togglePanel, selectPanel, closePanel } = usePanelParams(selected)
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
          />
        }
        main={
          <Routes>
            <Route path="/" element={<HomeRedirect state={state} />} />
            <Route path="/bots/:name" element={<BotRoute state={state} crewConnected={connected} name={selected ?? ''} panel={panel} onPanel={togglePanel} />} />
            <Route path="/needs-you" element={state ? <NeedsYouPage state={state} crewConnected={connected} /> : <Loading />} />
            <Route path="*" element={<Navigate replace to="/" />} />
          </Routes>
        }
        panel={panelBot && panel ? <PanelBoundary key={`${panelBot.name}-${panel}`}><BotPanel bot={panelBot} tab={panel} onTab={selectPanel} onClose={closePanel} /></PanelBoundary> : null}
        panelOpen={panelBot !== undefined}
      />
      <NewBotDialog open={newBotOpen} onOpenChange={setNewBotOpen} onCreated={name => navigate(`/bots/${encodeURIComponent(name)}`)} />
    </>
  )
}
