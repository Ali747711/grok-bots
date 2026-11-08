import { Shell } from '@/layout/Shell'

export default function App() {
  return (
    <Shell
      sidebar={<div className="px-2 pb-3 text-base font-bold tracking-tight">Crew</div>}
      main={
        <div className="grid flex-1 place-items-center text-sm text-muted-foreground">
          Pick a bot to start.
        </div>
      }
      panel={null}
      panelOpen={false}
    />
  )
}
