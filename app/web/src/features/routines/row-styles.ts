/** Ghost buttons on a routine row's well (`bg-background`) lift to the shell on hover and while open. */
// dark:hover:bg-shell is needed because the ghost variant's own dark:hover:bg-muted/50 would otherwise win in dark.
export const GHOST = 'hover:bg-shell dark:hover:bg-shell aria-expanded:bg-shell'
