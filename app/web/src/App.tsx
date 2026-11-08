import { matchPath, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'

import { ChatView } from '@/features/chat/ChatView'
import { NeedsYouPage } from '@/features/needs-you/NeedsYouPage'
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

function BotRoute({ state, crewConnected, name }: { state: CrewState | null; crewConnected: boolean; name: string }) {
  if (!state) return <div className={centered}>Loading…</div>
  const bot = state.bots.find(b => b.name === name)
  if (!bot) return <div className={centered}>Bot not found</div>
  return <ChatView key={bot.name} bot={bot} state={state} crewConnected={crewConnected} />
}

export default function App() {
  const { state, connected } = useCrewState()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const selected = matchPath('/bots/:name', pathname)?.params.name ?? null

  return (
    <Shell
      sidebar={
        <Sidebar
          state={state}
          crewConnected={connected}
          selected={selected}
          onSelect={name => navigate(`/bots/${encodeURIComponent(name)}`)}
          onNeedsYou={() => navigate('/needs-you')}
        />
      }
      main={
        <Routes>
          <Route path="/" element={<HomeRedirect state={state} />} />
          <Route path="/bots/:name" element={<BotRoute state={state} crewConnected={connected} name={selected ?? ''} />} />
          <Route path="/needs-you" element={state ? <NeedsYouPage state={state} /> : <div className={centered}>Loading…</div>} />
          <Route path="*" element={<Navigate replace to="/" />} />
        </Routes>
      }
      panel={null}
      panelOpen={false}
    />
  )
}
