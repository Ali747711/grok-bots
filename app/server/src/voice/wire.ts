import { join } from 'node:path'

import type { BotDeps } from '../bots/create.js'
import type { CrewConfig } from '../config.js'
import type { KeyStore } from '../connectors/key.js'
import type { AppLevel } from '../connectors/levels.js'
import type { ConnectorStore } from '../connectors/store.js'
import type { RoutineService } from '../routines/service.js'
import type { SettingsStore } from '../settings/settings-store.js'
import type { CrewStateSource } from '../state/crew-state.js'
import { migrateAll } from './migrate.js'
import { rosterFingerprint } from './scheduler.js'
import { createVoiceService, refreshRightNow, type VoiceService, type VoiceServiceDeps } from './service.js'
import { VoiceStore } from './voice-store.js'

export interface VoiceWiring {
  readonly config: CrewConfig
  readonly bots: BotDeps
  readonly crewState: CrewStateSource
  readonly settings: Pick<SettingsStore, 'get' | 'onChange'>
  readonly routines: RoutineService
  readonly connectors?: { readonly store: ConnectorStore; readonly keys: KeyStore }
}

const TEST_BOT_RE = /^e2e\d+$/

function appsOf(connectors: VoiceWiring['connectors'], bot: string): readonly { name: string; level: AppLevel }[] {
  if (!connectors || connectors.keys.get() === null) return []
  const apps = connectors.store.record(bot)?.apps ?? {}
  return Object.entries(apps).map(([slug, level]) => ({ name: connectors.store.name(slug) ?? slug, level }))
}

/** Resolves once Hermes is connected and the roster has been read (the first pass needs real names). */
function rosterReady(crewState: CrewStateSource): Promise<void> {
  return new Promise(resolve => {
    const check = (): boolean => crewState.state().hermes === 'connected' && crewState.state().bots.length > 0
    if (check()) return resolve()
    const off = crewState.onChange(() => {
      if (!check()) return
      off()
      resolve()
    })
  })
}

/** Before the first refresh: back up and rewrite every in-scope bot once (spec 2026-11-12 §4.6). */
function firstPass(input: VoiceWiring, deps: () => VoiceServiceDeps): () => Promise<void> {
  return async () => {
    await rosterReady(input.crewState)
    const names = input.crewState.state().bots.map(b => b.name).filter(name => deps().inScope(name))
    await migrateAll({
      bots: input.bots, store: deps().store, backupDir: join(input.config.stateDir, 'soul-backups'), now: Date.now,
      refreshNow: bot => refreshRightNow(deps(), bot)
    }, names)
  }
}

/** Builds the voice service, binds it to `bots.voice` and hooks every trigger of spec 2026-11-12 §4.2. */
export async function wireVoice(input: VoiceWiring): Promise<VoiceService> {
  const { config, bots, crewState, settings, routines, connectors } = input
  const store = await VoiceStore.load(join(config.stateDir, 'voice.json'))
  const deps: VoiceServiceDeps = {
    bots,
    store,
    hermesHome: config.hermesHome,
    owner: () => ({ name: settings.get().ownerName, timeZone: settings.get().timeZone }),
    roster: () => crewState.state().bots,
    groups: () => crewState.state().groups,
    apps: bot => appsOf(connectors, bot),
    routines: bot => routines.list(bot),
    inScope: bot => config.voiceScope === 'all' || TEST_BOT_RE.test(bot)
  }
  const service = createVoiceService({ ...deps, beforeFirstPass: firstPass(input, () => deps) })
  bots.voice = service
  let fingerprint = ''
  crewState.onChange(() => {
    const state = crewState.state()
    if (state.hermes !== 'connected') return
    const next = rosterFingerprint(state.bots, state.groups)
    if (next !== fingerprint) {
      fingerprint = next
      service.changed()
    }
  })
  settings.onChange(() => service.changed())
  connectors?.store.onRecordChange(bot => service.changed(bot))
  return service
}

/** The routine service, telling the voice service after every change a bot's routine list shows. */
export function routinesWithVoice(routines: RoutineService, voice: Pick<VoiceService, 'changed'>): RoutineService {
  const after = <T>(bot: string, run: Promise<T>): Promise<T> => run.then(result => {
    voice.changed(bot)
    return result
  })
  return {
    ...routines,
    create: (bot, input) => after(bot, routines.create(bot, input)),
    update: (bot, id, input) => after(bot, routines.update(bot, id, input)),
    pause: (bot, id) => after(bot, routines.pause(bot, id)),
    resume: (bot, id) => after(bot, routines.resume(bot, id)),
    remove: (bot, id) => after(bot, routines.remove(bot, id))
  }
}
