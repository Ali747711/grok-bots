/** The app's initial on a round tile; made for a `bg-background` row. */
export function AppTile({ name }: { name: string }) {
  return (
    <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-shell text-[13px] font-semibold text-foreground">
      {name.charAt(0).toUpperCase()}
    </span>
  )
}
