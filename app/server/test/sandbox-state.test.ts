import { describe, expect, it } from 'vitest'

import { DEFAULT_IMAGE } from '../src/sandbox/docker.js'
import {
  OFF_MARKER, REASONS, createPatch, SANDBOX_MEMORY_MB, effectiveImage, offPatch, onPatch, rawToolsetList, readMarker, sandboxStateOf
} from '../src/bots/sandbox-state.js'

const base = (terminal: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  terminal: { backend: 'docker', ...terminal },
  agent: { disabled_toolsets: ['browser'] },
  ...extra
})

const ESCAPES: [string, unknown, keyof typeof REASONS][] = [
  ['browser not disabled', { terminal: { backend: 'docker' }, agent: { disabled_toolsets: ['tts'] } }, 'browser'],
  ['docker_volumes', base({ docker_volumes: ['/a:/b'] }), 'folder'],
  ['mount cwd', base({ docker_mount_cwd_to_workspace: true }), 'folder'],
  ['-v arg', base({ docker_extra_args: ['-v', '/a:/b'] }), 'folder'],
  ['-v/a:/b arg', base({ docker_extra_args: ['-v/a:/b'] }), 'folder'],
  ['--volume=', base({ docker_extra_args: ['--volume=/a:/b'] }), 'folder'],
  ['--mount arg', base({ docker_extra_args: ['--mount', 'type=bind'] }), 'folder'],
  ['string args', base({ docker_extra_args: '--mount=type=bind' }), 'folder'],
  ['--network host', base({ docker_extra_args: ['--network', 'host'] }), 'network'],
  ['--network=host', base({ docker_extra_args: ['--network=host'] }), 'network'],
  ['--net host', base({ docker_extra_args: '--net host' }), 'network'],
  ['--net=host', base({ docker_extra_args: ['--net=host'] }), 'network'],
  ['--privileged', base({ docker_extra_args: ['--privileged'] }), 'privileged'],
  ['--privileged=true', base({ docker_extra_args: ['--privileged=true'] }), 'privileged'],
  ['--pid host', base({ docker_extra_args: ['--pid', 'host'] }), 'pid'],
  ['--pid=host', base({ docker_extra_args: ['--pid=host'] }), 'pid'],
  ['--cap-add', base({ docker_extra_args: ['--cap-add', 'SYS_ADMIN'] }), 'caps'],
  ['--cap-add=', base({ docker_extra_args: ['--cap-add=ALL'] }), 'caps'],
  ['forward env', base({ docker_forward_env: ['KEY'] }), 'env'],
  ['gateway screen', base({}, { bot_desktop: { placement: 'gateway' } }), 'screen'],
  ['cdp url', base({}, { browser: { cdp_url: 'http://x' } }), 'hostBrowser'],
  ['lightpanda', base({}, { browser: { engine: 'lightpanda' } }), 'hostBrowser'],
  ['real profile', base({}, { browser: { use_real_profile: true } }), 'hostBrowser'],
  ['shared key', base({ docker_shared_container_key: 'k' }), 'shared']
]

describe('sandboxStateOf', () => {
  it('is on only with docker, browser disabled and no escape settings', () => {
    expect(sandboxStateOf(base())).toEqual({ state: 'on', reasons: [] })
  })

  it('is off for local, a missing backend or another backend', () => {
    for (const backend of ['local', undefined, 'ssh']) {
      expect(sandboxStateOf({ terminal: { backend }, agent: { disabled_toolsets: [] } }).state).toBe('off')
    }
    expect(sandboxStateOf(null).state).toBe('off')
  })

  it.each(ESCAPES)('is partial with the plain reason for %s', (_label, raw, key) => {
    expect(sandboxStateOf(raw)).toEqual({ state: 'partial', reasons: [REASONS[key]] })
  })

  it('lists each reason once', () => {
    const result = sandboxStateOf(base({ docker_volumes: ['/a:/b'], docker_extra_args: ['-v', 'x', '--volume=y'] }))
    expect(result.reasons).toEqual([REASONS.folder])
  })

  it('lists reasons in table order', () => {
    const raw = { terminal: { backend: 'docker', docker_shared_container_key: 'k', docker_forward_env: ['A'] }, agent: { disabled_toolsets: [] } }
    expect(sandboxStateOf(raw).reasons).toEqual([REASONS.browser, REASONS.env, REASONS.shared])
  })

  it('uses the pinned docker_image or the default image', () => {
    expect(effectiveImage({ terminal: { docker_image: 'me/img:1' } })).toBe('me/img:1')
    expect(effectiveImage({ terminal: { docker_image: '' } })).toBe(DEFAULT_IMAGE)
    expect(effectiveImage({ terminal: { docker_image: 5 } })).toBe(DEFAULT_IMAGE)
    expect(effectiveImage({})).toBe(DEFAULT_IMAGE)
  })
})

describe('createPatch', () => {
  const cloned = { agent: { disabled_toolsets: ['tts', 'browser'] } }
  it("counts a cloned browser entry as Crew's only when the primary's marker says so", () => {
    const crew = { on: true, addedBrowserDisable: true }
    const user = { on: true, addedBrowserDisable: false }
    expect(createPatch(cloned, false, crew).config).toEqual({ terminal: { backend: 'local' }, agent: { disabled_toolsets: ['tts'] } })
    expect(createPatch(cloned, false, user).config).toEqual({ terminal: { backend: 'local' } })
    expect(createPatch(cloned, true, crew).marker).toEqual({ on: true, addedBrowserDisable: true })
    expect(createPatch(cloned, true, user).marker).toEqual({ on: true, addedBrowserDisable: false })
    expect(createPatch({}, true, OFF_MARKER).marker).toEqual({ on: true, addedBrowserDisable: true })
    expect(createPatch({}, false, crew).marker).toEqual(OFF_MARKER)
  })

  it("keeps the user's own toolsets and reads a string list like Hermes", () => {
    expect(createPatch({ agent: { disabled_toolsets: "['tts', 'browser']" } }, false, { on: true, addedBrowserDisable: true }).config)
      .toEqual({ terminal: { backend: 'local' }, agent: { disabled_toolsets: ['tts'] } })
  })
})

describe('markers and patches', () => {
  it('reads malformed markers as off', () => {
    expect(readMarker(null)).toEqual(OFF_MARKER)
    expect(readMarker({ sandbox: 'x' })).toEqual(OFF_MARKER)
    expect(readMarker({ sandbox: { on: true } })).toEqual(OFF_MARKER)
    expect(readMarker({ sandbox: { on: true, addedBrowserDisable: true } })).toEqual({ on: true, addedBrowserDisable: true })
  })

  it('returns the toolset list as is', () => {
    expect(rawToolsetList({ agent: { disabled_toolsets: ['a', 3] } })).toEqual(['a', 3])
    expect(rawToolsetList({ agent: { disabled_toolsets: 'x' } })).toEqual(['x'])
    expect(rawToolsetList({ agent: { disabled_toolsets: " ['tts', 'x'] " } })).toEqual(['tts', 'x'])
    expect(rawToolsetList({ agent: { disabled_toolsets: '["tts"]' } })).toEqual(['tts'])
    expect(rawToolsetList({ agent: { disabled_toolsets: '[oops' } })).toEqual(['[oops'])
    expect(rawToolsetList({ agent: { disabled_toolsets: '  ' } })).toEqual([])
    expect(rawToolsetList({ agent: { disabled_toolsets: 5 } })).toEqual([])
    expect(rawToolsetList(undefined)).toEqual([])
  })

  it('onPatch adds browser to the full list and records it', () => {
    const patch = onPatch({ agent: { disabled_toolsets: ['tts'] } }, OFF_MARKER)
    expect(patch.config).toEqual({
      terminal: { backend: 'docker', container_memory: SANDBOX_MEMORY_MB, docker_run_as_host_user: true },
      agent: { disabled_toolsets: ['tts', 'browser'] }
    })
    expect(patch.marker).toEqual({ on: true, addedBrowserDisable: true })
  })

  it('onPatch leaves a user browser entry alone and keeps an earlier added flag', () => {
    const patch = onPatch({ agent: { disabled_toolsets: ['browser'] } }, OFF_MARKER)
    expect(patch.config).not.toHaveProperty('agent')
    expect(patch.marker).toEqual({ on: true, addedBrowserDisable: false })
    expect(onPatch({ agent: { disabled_toolsets: ['browser'] } }, { on: true, addedBrowserDisable: true }).marker.addedBrowserDisable).toBe(true)
  })

  it('onPatch keeps a bare or quoted-list string toolset entry in the written array', () => {
    expect(onPatch({ agent: { disabled_toolsets: 'tts' } }, OFF_MARKER).config).toMatchObject({ agent: { disabled_toolsets: ['tts', 'browser'] } })
    expect(onPatch({ agent: { disabled_toolsets: "['tts']" } }, OFF_MARKER).config).toMatchObject({ agent: { disabled_toolsets: ['tts', 'browser'] } })
  })

  it('treats a bare browser string as the user own entry', () => {
    const raw = { terminal: { backend: 'docker' }, agent: { disabled_toolsets: 'browser' } }
    expect(sandboxStateOf(raw)).toEqual({ state: 'on', reasons: [] })
    const on = onPatch(raw, OFF_MARKER)
    expect(on.config).not.toHaveProperty('agent')
    expect(on.marker.addedBrowserDisable).toBe(false)
    expect(offPatch(raw, on.marker).config).toEqual({ terminal: { backend: 'local' } })
  })

  it('offPatch removes browser only when Crew added it', () => {
    const added = offPatch({ agent: { disabled_toolsets: ['tts', 'browser'] } }, { on: true, addedBrowserDisable: true })
    expect(added.config).toEqual({ terminal: { backend: 'local' }, agent: { disabled_toolsets: ['tts'] } })
    expect(added.marker).toEqual(OFF_MARKER)
    const user = offPatch({ agent: { disabled_toolsets: ['browser'] } }, { on: true, addedBrowserDisable: false })
    expect(user.config).toEqual({ terminal: { backend: 'local' } })
    const gone = offPatch({ agent: { disabled_toolsets: [] } }, { on: true, addedBrowserDisable: true })
    expect(gone.config).toEqual({ terminal: { backend: 'local' } })
  })
})
