import { useState } from 'react'

import { Sidebar } from '@/features/roster/Sidebar'
import { Shell } from '@/layout/Shell'
import { useCrewState } from '@/state/use-crew-state'

export default function App() {
  const { state } = useCrewState()
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <Shell
      sidebar={<Sidebar state={state} selected={selected} onSelect={setSelected} />}
      main={
        <div className="grid flex-1 place-items-center text-sm text-muted-foreground">
          {selected ? `Chat with ${selected} comes next.` : 'Pick a bot to start.'}
        </div>
      }
      panel={null}
      panelOpen={false}
    />
  )
}
