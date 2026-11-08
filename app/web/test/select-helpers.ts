import { fireEvent, screen } from '@testing-library/react'

/** Open a shadcn Select by its accessible name and choose an option by its visible text.
 * Base UI only commits an item click that began with a pointer-down on it. */
export function pickOption(label: string, option: string): void {
  fireEvent.click(screen.getByRole('combobox', { name: label }))
  const item = screen.getByRole('option', { name: option })
  fireEvent.pointerDown(item)
  fireEvent.click(item)
}
