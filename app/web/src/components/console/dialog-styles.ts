// Type and surface classes the dialogs and forms share (spec §5.3), so they read as one design.

/** Dialog title: the panel-title size. */
export const DIALOG_TITLE = 'text-[15px] font-semibold tracking-tight'
export const DIALOG_DESCRIPTION = 'text-[13px] font-medium'
/** A label with its control and notes. */
export const FIELD = 'flex flex-col gap-2'
export const FIELD_LABEL = 'px-1 text-[13px] font-semibold'
/** A note under a control. Faint text: only on the shell or a well, never on `bg-control`. */
export const HINT = 'px-1 text-xs font-medium text-faint'
/** A failure, as plain red text on the shell or a well (never on a red tint). */
export const ERROR_TEXT = 'px-1 text-[13px] font-medium text-destructive'
/** An inner surface on a shell. */
export const WELL = 'rounded-2xl bg-background'
/** A ghost button on a well lifts to the shell (the ghost variant's own dark hover would otherwise win). */
export const GHOST_ON_WELL = 'hover:bg-shell dark:hover:bg-shell aria-expanded:bg-shell'
