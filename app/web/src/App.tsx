import { useCallback, useEffect, useRef, useState } from 'react'
import { matchPath, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { type BotPanel, type SidePanelTab, botUrl, parseBotPanel, railTarget } from '@/app/panel-params'
import { BotRoute, GroupRoute, HomeRedirect, Loading } from '@/app/routes'
import { readSidePanel, rememberSidePanel } from '@/app/side-panel-memory'
import { useAppShortcuts } from '@/app/use-app-shortcuts'
import { NewBotDialog } from '@/features/bots/NewBotDialog'
import { ChatSessionProvider } from '@/features/chat/chat-session-context'
import { GroupPanel } from '@/features/groups/GroupPanel'
import { NewGroupDialog } from '@/features/groups/NewGroupDialog'
import { NeedsYouPage } from '@/features/needs-you/NeedsYouPage'
import { PanelBoundary } from '@/features/panel/PanelBoundary'
import { Sidebar } from '@/features/roster/Sidebar'
import { SidePanel } from '@/features/side-panel/SidePanel'
import { Shell } from '@/layout/Shell'
import type { CrewState } from '@/state/types'
import { useCrewState } from '@/state/use-crew-state'

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

/** Where the URL points: the open bot or group, and what `?panel=` opens there. The URL is the only source (spec §6.2). */
function useWhere() {
  const { pathname, search } = useLocation()
  const [params] = useSearchParams()
  const selected = matchPath('/bots/:name', pathname)?.params.name ?? null
  const selectedGroupId = matchPath('/groups/:roomId', pathname)?.params.roomId ?? null
  const panel = selected ? parseBotPanel(params.get('panel')) : null
  // The last bot page as it was, for Esc on the Needs-you page.
  const lastBotUrl = useRef<string | null>(null)
  useEffect(() => {
    if (selected) lastBotUrl.current = pathname + search
  }, [selected, pathname, search])
  return {
    selected,
    selectedGroupId,
    panel,
    sideTab: panel !== null && panel !== 'profile' ? panel : null,
    groupPanel: selectedGroupId !== null && params.get('panel') === 'group',
    onNeedsYou: matchPath('/needs-you', pathname) !== null,
    lastBotUrl
  }
}

export default function App() {
  const { state, connected } = useCrewState()
  const navigate = useNavigate()
  const [newBotOpen, setNewBotOpen] = useState(false)
  const [newGroupOpen, setNewGroupOpen] = useState(false)
  const goHome = useCallback(() => navigate('/', { replace: true }), [navigate])
  const { selected, selectedGroupId, panel, sideTab, groupPanel, onNeedsYou, lastBotUrl } = useWhere()
  const seatable = new Set(state?.groups?.seatable ?? [])
  const groupBots = (state?.bots ?? []).filter(b => !b.hidden && seatable.has(b.name))
  const bot = (selected && state?.bots.find(b => b.name === selected)) || null
  const panelGroup = groupPanel ? state?.groups?.rooms.find(r => r.id === selectedGroupId) : undefined
  const groupUrl = (roomId: string, open: boolean) => `/groups/${encodeURIComponent(roomId)}${open ? '?panel=group' : ''}`

  useLeaveDeletedBot(state, selected, goHome)

  // The user's own choices (header buttons, side tabs, Close panel, ⌘\) are remembered; the profile is not a side panel.
  const showPanel = (next: BotPanel | null) => {
    if (!selected) return
    if (next !== 'profile' && panel !== 'profile') rememberSidePanel(next)
    navigate(botUrl(selected, next))
  }
  const showSide = (next: SidePanelTab | null) => showPanel(next)

  useAppShortcuts({
    ...(selected && panel !== 'profile' ? { toggleSide: () => showSide(sideTab ? null : 'computer') } : {}),
    ...(selected && panel === 'profile' ? { leave: () => navigate(botUrl(selected, null)) } : {}),
    ...(onNeedsYou ? { leave: () => navigate(lastBotUrl.current ?? '/') } : {})
  })

  return (
    <ChatSessionProvider bot={bot}>
      <Shell
        rail={
          <Sidebar
            state={state}
            crewConnected={connected}
            selected={selected}
            onSelect={name => navigate(railTarget(name, { onBotPage: selected !== null, panel }, readSidePanel()))}
            needsYouActive={onNeedsYou}
            onNeedsYou={() => navigate('/needs-you')}
            onNewBot={() => setNewBotOpen(true)}
            selectedGroupId={selectedGroupId}
            onSelectGroup={roomId => navigate(groupUrl(roomId, false))}
            onNewGroup={() => setNewGroupOpen(true)}
          />
        }
        main={
          <Routes>
            <Route path="/" element={<HomeRedirect state={state} />} />
            <Route path="/bots/:name" element={<BotRoute key={selected} state={state} crewConnected={connected} name={selected ?? ''} panel={panel} onPanel={showPanel} />} />
            <Route path="/groups/:roomId" element={<GroupRoute key={selectedGroupId} state={state} crewConnected={connected} roomId={selectedGroupId ?? ''} panelOpen={groupPanel} onPanel={() => navigate(groupUrl(selectedGroupId ?? '', !groupPanel))} />} />
            <Route path="/needs-you" element={state ? <NeedsYouPage state={state} crewConnected={connected} /> : <Loading />} />
            <Route path="*" element={<Navigate replace to="/" />} />
          </Routes>
        }
        side={panelGroup ? (
          <PanelBoundary key={`group-${panelGroup.id}`}>
            <GroupPanel view={panelGroup} bots={state?.bots ?? []} stale={state === null || state.hermes !== 'connected' || !connected} onDeleted={goHome} onClose={() => navigate(groupUrl(panelGroup.id, false))} />
          </PanelBoundary>
        ) : bot && sideTab ? <SidePanel bot={bot} tab={sideTab} onTab={showSide} onClose={() => showSide(null)} /> : null}
      />
      <NewGroupDialog open={newGroupOpen} onOpenChange={setNewGroupOpen} bots={groupBots} onCreated={roomId => navigate(groupUrl(roomId, false))} />
      <NewBotDialog open={newBotOpen} onOpenChange={setNewBotOpen} onCreated={name => navigate(botUrl(name, null))} />
    </ChatSessionProvider>
  )
}
