import { useCallback, useEffect, useRef, useState } from 'react'

import { getBotApps } from '@/features/apps/apps-api'
import type { BotAppsView } from '@/features/apps/apps-types'
import { type ScreenConfigView, getScreenConfig } from '@/lib/crew-api'

import { type ApprovalsView, getApprovals, profileErrorText } from './profile-api'

export interface SettingsErrors {
  readonly approvals: string | null
  readonly screen: string | null
  readonly apps: string | null
}

export interface ProfileSettings {
  readonly approvals: ApprovalsView | null
  readonly screen: ScreenConfigView | null
  /** How many apps the bot may use; null while unknown. */
  readonly appsOn: number | null
  /** The first read failure, if any. */
  readonly error: string | null
  /** Why each part could not be read; a part that failed keeps its last value. */
  readonly errors: SettingsErrors
  /** Re-reads the three parts. Never rejects; resolves with why each part could not be read this time. */
  reload(): Promise<SettingsErrors>
  /** Shows what a write just answered, before the re-read confirms it. */
  apply(written: Written): void
}

/** The parts a write's answer carries. */
export interface Written {
  readonly approvals?: ApprovalsView
  readonly screen?: ScreenConfigView
}

interface Loaded {
  readonly approvals: ApprovalsView | null
  readonly screen: ScreenConfigView | null
  readonly appsOn: number | null
  readonly errors: SettingsErrors
}

const NO_ERRORS: SettingsErrors = { approvals: null, screen: null, apps: null }
const EMPTY: Loaded = { approvals: null, screen: null, appsOn: null, errors: NO_ERRORS }

const MODES: readonly string[] = ['manual', 'smart', 'off']

// The answers are checked before use: an older server or a proxy can answer 200 with another shape.
export const isApprovals = (v: ApprovalsView): boolean => MODES.includes(v?.mode)
export const isScreen = (v: ScreenConfigView): boolean => typeof v?.useScreen === 'boolean'
const isApps = (v: BotAppsView): boolean => Array.isArray(v?.apps)

/** A read that answered with the wrong shape counts as a failed read. */
async function checked<T>(read: Promise<T>, valid: (value: T) => boolean): Promise<T> {
  const value = await read
  if (!valid(value)) throw new Error('unexpected answer')
  return value
}

const valueOf = <T,>(result: PromiseSettledResult<T>, previous: T | null): T | null => (result.status === 'fulfilled' ? result.value : previous)
const reasonOf = (result: PromiseSettledResult<unknown>): string | null => (result.status === 'rejected' ? profileErrorText(result.reason, { read: true }) : null)

/**
 * The bot settings that live outside its profile form: approvals, the screen config and how many apps
 * it may use. The three are read together and each fails on its own. `reload` never rejects.
 */
export function useProfileSettings(name: string): ProfileSettings {
  const [loaded, setLoaded] = useState<Loaded>(EMPTY)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // Counts reloads and writes: an answer is shown only while nothing newer has started since it was asked for.
  const turn = useRef(0)

  const reload = useCallback(async () => {
    const mine = ++turn.current
    const [approvals, screen, apps] = await Promise.allSettled([
      checked(getApprovals(name), isApprovals), checked(getScreenConfig(name), isScreen), checked(getBotApps(name), isApps)
    ])
    const errors: SettingsErrors = { approvals: reasonOf(approvals), screen: reasonOf(screen), apps: reasonOf(apps) }
    // A stale answer (an older reload, or one from before a write) never replaces what is shown.
    if (!alive.current || mine !== turn.current) return errors
    setLoaded(previous => ({
      approvals: valueOf(approvals, previous.approvals),
      screen: valueOf(screen, previous.screen),
      appsOn: apps.status === 'fulfilled' ? apps.value.apps.length : previous.appsOn,
      errors
    }))
    return errors
  }, [name])

  const apply = useCallback((written: Written) => {
    turn.current += 1
    setLoaded(previous => ({
      ...previous,
      ...written,
      errors: { ...previous.errors, ...(written.approvals ? { approvals: null } : {}), ...(written.screen ? { screen: null } : {}) }
    }))
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const { errors } = loaded
  return { approvals: loaded.approvals, screen: loaded.screen, appsOn: loaded.appsOn, error: errors.approvals ?? errors.screen ?? errors.apps, errors, reload, apply }
}
