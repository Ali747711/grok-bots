/**
 * Call just before a row removes itself. Moves focus to the same kind of control in the next (or
 * previous) row, so keyboard users are not dropped back to the top of the page. Falls back to the
 * nearest `[data-focus-fallback]`.
 */
export function focusNeighborControl(control: HTMLElement, rowSelector: string): void {
  const row = control.closest(rowSelector)
  const neighbor = row?.nextElementSibling ?? row?.previousElementSibling
  const target = neighbor?.querySelector<HTMLElement>('button') ?? control.closest<HTMLElement>('[data-focus-fallback]')
  target?.focus()
}
