import { DEFAULT_IMAGE } from '../sandbox/docker.js'

export type SandboxState = 'off' | 'on' | 'partial'
export interface SandboxMarker { readonly on: boolean; readonly addedBrowserDisable: boolean }

export const OFF_MARKER: SandboxMarker = { on: false, addedBrowserDisable: false }
export const SANDBOX_MEMORY_MB = 3072

export const REASONS = {
  browser: 'Browser tools are on, so they run outside the sandbox',
  folder: 'A folder from your computer is shared into the sandbox',
  network: "The sandbox uses your computer's network",
  privileged: 'The sandbox has full access to your computer',
  pid: "The sandbox can see your computer's programs",
  caps: 'The sandbox has extra system permissions',
  env: 'Keys from your computer are passed into the sandbox',
  screen: "The bot's screen runs outside the sandbox",
  hostBrowser: "The bot's browser runs outside the sandbox",
  shared: 'The sandbox is shared with other bots'
} as const satisfies Readonly<Record<string, string>>

type Section = Record<string, unknown>
const section = (value: unknown): Section =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Section) : {}
const nonEmpty = (value: unknown): boolean =>
  Array.isArray(value) ? value.length > 0 : typeof value === 'string' ? value.length > 0 : false

export function rawToolsetList(raw: unknown): readonly unknown[] {
  const list = section(section(raw).agent).disabled_toolsets
  return Array.isArray(list) ? list : []
}

function extraArgs(terminal: Section): string[] {
  const value = terminal.docker_extra_args
  if (Array.isArray(value)) return value.filter((x): x is string => typeof x === 'string')
  return typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : []
}

/** True when the args hold `--flag value` or `--flag=value` for one of the flags. */
function hasValued(args: readonly string[], flags: readonly string[], value: string): boolean {
  return args.some((arg, i) => flags.some(f => arg === `${f}=${value}` || (arg === f && args[i + 1] === value)))
}

const hasFlag = (args: readonly string[], flag: string): boolean =>
  args.some(arg => arg === flag || arg.startsWith(`${flag}=`))

function escapeKeys(raw: unknown): (keyof typeof REASONS)[] {
  const root = section(raw)
  const terminal = section(root.terminal)
  const browser = section(root.browser)
  const args = extraArgs(terminal)
  const found: [keyof typeof REASONS, boolean][] = [
    ['browser', !rawToolsetList(raw).includes('browser')],
    ['folder', nonEmpty(terminal.docker_volumes) || terminal.docker_mount_cwd_to_workspace === true ||
      args.some(a => (a.startsWith('-v') && !a.startsWith('--')) || a === '--volume' || a.startsWith('--volume=') || a === '--mount' || a.startsWith('--mount='))],
    ['network', hasValued(args, ['--network', '--net'], 'host')],
    ['privileged', args.some(a => a === '--privileged' || a === '--privileged=true')],
    ['pid', hasValued(args, ['--pid'], 'host')],
    ['caps', hasFlag(args, '--cap-add')],
    ['env', nonEmpty(terminal.docker_forward_env)],
    ['screen', section(root.bot_desktop).placement === 'gateway'],
    ['hostBrowser', nonEmpty(browser.cdp_url) || browser.engine === 'lightpanda' || browser.use_real_profile === true],
    ['shared', nonEmpty(terminal.docker_shared_container_key)]
  ]
  return found.filter(([, hit]) => hit).map(([key]) => key)
}

export function sandboxStateOf(raw: unknown): { readonly state: SandboxState; readonly reasons: readonly string[] } {
  if (section(section(raw).terminal).backend !== 'docker') return { state: 'off', reasons: [] }
  const reasons = escapeKeys(raw).map(key => REASONS[key])
  return { state: reasons.length === 0 ? 'on' : 'partial', reasons }
}

export function effectiveImage(raw: unknown): string {
  const image = section(section(raw).terminal).docker_image
  return typeof image === 'string' && image.length > 0 ? image : DEFAULT_IMAGE
}

export function readMarker(meta: unknown): SandboxMarker {
  const marker = section(section(meta).sandbox)
  if (typeof marker.on !== 'boolean' || typeof marker.addedBrowserDisable !== 'boolean') return OFF_MARKER
  return { on: marker.on, addedBrowserDisable: marker.addedBrowserDisable }
}

export interface SandboxPatch { readonly config: Record<string, unknown>; readonly marker: SandboxMarker }

/** Hermes replaces arrays on merge, so the toolset list is always written whole. */
export function onPatch(raw: unknown, marker: SandboxMarker): SandboxPatch {
  const list = rawToolsetList(raw)
  const missing = !list.includes('browser')
  return {
    config: {
      terminal: { backend: 'docker', container_memory: SANDBOX_MEMORY_MB, docker_run_as_host_user: true },
      ...(missing ? { agent: { disabled_toolsets: [...list, 'browser'] } } : {})
    },
    marker: { on: true, addedBrowserDisable: missing || marker.addedBrowserDisable }
  }
}

export function offPatch(raw: unknown, marker: SandboxMarker): SandboxPatch {
  const list = rawToolsetList(raw)
  const strip = marker.addedBrowserDisable && list.includes('browser')
  return {
    config: {
      terminal: { backend: 'local' },
      ...(strip ? { agent: { disabled_toolsets: list.filter(x => x !== 'browser') } } : {})
    },
    marker: OFF_MARKER
  }
}
