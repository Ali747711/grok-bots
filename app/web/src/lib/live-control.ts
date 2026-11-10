// Whether the user currently holds control of a bot's screen. Window shortcuts read it
// (hooks/use-window-keydown.ts) so a keystroke meant for the remote desktop never switches bots.
let held = false

export function setLiveControlHeld(next: boolean): void {
  held = next
}

export function liveControlHeld(): boolean {
  return held
}
