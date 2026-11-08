import { useCallback, useEffect, useRef, useState } from 'react'
import { matchPath, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom'

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

function HomeRedirect({ state }: { state: CrewState | null }) {
  const primary = state?.bots.find(b => b.isPrimary) ?? state?.bots[0]
  if (!primary) return <div className={centered}>Loading…</div>
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
  if (!state) return <div className={centered}>Loading…</div>
  const bot = state.bots.find(b => b.name === name)
  if (!bot) return <div className={centered}>Bot not found</div>
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

export default function App() {
  const { state, connected } = useCrewState()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [params, setParams] = useSearchParams()
  const [newBotOpen, setNewBotOpen] = useState(false)
  const goHome = useCallback(() => navigate('/', { replace: true }), [navigate])
  const selected = matchPath('/bots/:name', pathname)?.params.name ?? null

  useLeaveDeletedBot(state, selected, goHome)
  const requested = params.get('panel')
  const panel = selected && isPanelTab(requested) ? requested : null
  const panelBot = panel ? state?.bots.find(b => b.name === selected) : undefined
  // Clicking the open tab closes the panel; the choice lives in the URL so a reload keeps it.
  const togglePanel = (tab: PanelTab) => setParams(prev => {
    const next = new URLSearchParams(prev)
    if (prev.get('panel') === tab) next.delete('panel')
    else next.set('panel', tab)
    return next
  })

  const selectPanel = (tab: PanelTab) => setParams(prev => {
    const next = new URLSearchParams(prev)
    next.set('panel', tab)
    return next
  })
  const closePanel = () => setParams(prev => {
    const next = new URLSearchParams(prev)
    next.delete('panel')
    return next
  })

  return (
    <>
      <Shell
        sidebar={
          <Sidebar
            state={state}
            crewConnected={connected}
            selected={selected}
            onSelect={name => navigate({ pathname: `/bots/${encodeURIComponent(name)}`, ...(panel ? { search: `?panel=${panel}` } : {}) })}
            needsYouActive={pathname === '/needs-you'}
            onNeedsYou={() => navigate('/needs-you')}
            onNewBot={() => setNewBotOpen(true)}
          />
        }
        main={
          <Routes>
            <Route path="/" element={<HomeRedirect state={state} />} />
            <Route path="/bots/:name" element={<BotRoute state={state} crewConnected={connected} name={selected ?? ''} panel={panel} onPanel={togglePanel} />} />
            <Route path="/needs-you" element={state ? <NeedsYouPage state={state} crewConnected={connected} /> : <div className={centered}>Loading…</div>} />
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
