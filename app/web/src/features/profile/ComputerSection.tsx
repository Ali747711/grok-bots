import { useId } from 'react'

import { ChoiceChips, type Option, Section, Switch } from '@/components/console/fields'
import { type IdleStopMinutes, type ScreenConfigView, setIdleStop, setUseScreen } from '@/lib/crew-api'

import { SLEEP_LABEL, sleepChoice } from './profile-api'
import { Note, PrimaryReason, ReadError, RowError, RowNotice } from './RowNotes'
import { useProfileRowAction } from './use-profile-row-action'
import { type SettingsErrors, isScreen } from './use-profile-settings'

interface ComputerSectionProps {
  name: string
  title: string
  isPrimary: boolean
  /** The screen config; null until it has been read. */
  screen: ScreenConfigView | null
  /** Why it could not be read. */
  readError: string | null
  reload: () => Promise<SettingsErrors>
  /** Shows what a write answered, before the re-read confirms it. */
  onWritten: (screen: ScreenConfigView) => void
}

type SleepValue = '15' | '60' | '0'

const SLEEP_OPTIONS: Option<SleepValue>[] = [
  { value: '15', label: SLEEP_LABEL[15] },
  { value: '60', label: SLEEP_LABEL[60] },
  { value: '0', label: SLEEP_LABEL[0] }
]
const MINUTES: Record<SleepValue, IdleStopMinutes> = { '15': 15, '60': 60, '0': 0 }

type RowProps = Pick<ComputerSectionProps, 'name' | 'title' | 'screen' | 'reload' | 'onWritten'>

/** One screen-config row's write: it shows what the write answered, or `sent` when the answer carries no config. */
function useScreenRow({ title, reload, onWritten }: Pick<RowProps, 'title' | 'reload' | 'onWritten'>) {
  const row = useProfileRowAction({ title, reload: async () => (await reload()).screen === null })
  const write = (send: () => Promise<ScreenConfigView>, sent: ScreenConfigView) =>
    row.run(async () => {
      const answer = await send()
      onWritten(isScreen(answer) ? answer : sent)
    })
  return { ...row, write }
}

/**
 * Lets the bot use its screen on its own (headed browser + auto start, written together by the
 * server). Not offered for the primary bot: new bots clone its config, so turning it on there would
 * make every later bot headed (§11 R8). On only when both keys are true.
 */
function UseScreenRow({ name, title, screen, reload, onWritten }: RowProps) {
  const { pending, error, notice, write } = useScreenRow({ title, reload, onWritten })
  const hintId = useId()
  const toggle = (useScreen: boolean) => {
    if (screen) void write(() => setUseScreen(name, useScreen), { ...screen, useScreen })
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3 rounded-2xl px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold">{`Let ${title} use its screen`}</p>
          <p id={hintId} className="text-xs font-medium text-faint">{`Takes effect the next time ${title} opens its browser.`}</p>
        </div>
        <Switch
          label={`Let ${title} use its screen`}
          describedBy={hintId}
          checked={screen?.useScreen === true}
          disabled={pending || screen === null}
          onChange={toggle}
        />
      </div>
      {error && <RowError>{error}</RowError>}
      {notice && <RowNotice>{notice}</RowNotice>}
    </div>
  )
}

/** How long an idle screen stays up (`bot_desktop.idle_stop_minutes`): Crew only ever writes 15, 60 or 0 (R3). */
function SleepRow({ name, title, screen, reload, onWritten, isPrimary }: RowProps & { isPrimary: boolean }) {
  const { pending, error, notice, write } = useScreenRow({ title, reload, onWritten })
  const choice = screen ? sleepChoice(screen.idleStopMinutes) : null
  const locked = isPrimary || pending || screen === null
  const choose = (value: SleepValue) => {
    // Checked here as well as on the chips: a locked setting never writes.
    if (!locked && MINUTES[value] !== choice) void write(() => setIdleStop(name, MINUTES[value]), { ...screen, idleStopMinutes: MINUTES[value] })
  }
  return (
    <div className="flex flex-col gap-1.5">
      <p className="px-1 text-[13px] font-semibold">Stop the screen after</p>
      <ChoiceChips legend="Stop the screen after" value={choice === null ? null : (String(choice) as SleepValue)} options={SLEEP_OPTIONS} onChange={choose} disabled={locked} />
      {choice === 0 && <Note>Each running screen holds about 350 MB until it's stopped.</Note>}
      {error && <RowError>{error}</RowError>}
      {notice && <RowNotice>{notice}</RowNotice>}
    </div>
  )
}

/** The bot's computer: whether it may use its screen on its own, and when an idle screen is stopped. */
export function ComputerSection({ name, title, isPrimary, screen, readError, reload, onWritten }: ComputerSectionProps) {
  const row = { name, title, screen, reload, onWritten }
  return (
    <Section title="Computer" hint={`${title}'s screen and when it is stopped.`}>
      {!isPrimary && <UseScreenRow {...row} />}
      <SleepRow {...row} isPrimary={isPrimary} />
      {screen === null && readError && <ReadError reason={readError} />}
      {isPrimary && <PrimaryReason title={title} />}
    </Section>
  )
}
