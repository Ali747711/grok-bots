import { describe, expect, it } from 'vitest'

import { approvalsViewOf } from '../src/bots/approvals.js'

describe('approvalsViewOf', () => {
  it.each([[undefined, 'smart', true], ['manual', 'manual', false], [' SMART ', 'smart', false], ['off', 'off', false], [false, 'off', false], [true, 'manual', false], ['weird', 'manual', false]])(
    'reads %j as %s (default %s)',
    (raw, mode, isDefault) => {
      const view = approvalsViewOf(raw === undefined ? {} : { approvals: { mode: raw } })
      expect(view).toMatchObject({ mode, isDefault })
    }
  )

  it('is sandboxed only when the sandbox state is on', () => {
    expect(approvalsViewOf({ terminal: { backend: 'docker' }, agent: { disabled_toolsets: ['browser'] } }).sandboxed).toBe(true)
    expect(approvalsViewOf({ terminal: { backend: 'docker', docker_volumes: ['/home/x:/x'] }, agent: { disabled_toolsets: ['browser'] } }).sandboxed).toBe(false)
    expect(approvalsViewOf({ terminal: { backend: 'local' } }).sandboxed).toBe(false)
    expect(approvalsViewOf({}).sandboxed).toBe(false)
  })
})
