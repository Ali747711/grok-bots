export function AppTile({ name }: { name: string }) {
  return (
    <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-medium text-foreground">
      {name.charAt(0).toUpperCase()}
    </span>
  )
}
