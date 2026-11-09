/** Ghost buttons on the muted row card need their own visible hover and open states. */
// dark:hover:bg-card is needed because the ghost variant's own dark:hover:bg-muted/50 would otherwise win in dark.
export const GHOST = 'hover:bg-card dark:hover:bg-card aria-expanded:bg-card'

/** Switch classes shared by the routine and trigger rows. */
export const SWITCH = 'data-checked:bg-foreground data-unchecked:border-muted-foreground'
