import { describe, expect, it } from 'vitest'

import { ARGS_TRUNCATED, appChoices, appPromptOf } from '../src/watcher/app-prompt.js'
import fixture from './fixtures/app-approval.json'

describe('appPromptOf', () => {
  it('recognises a crew_apps trust prompt by surface, head line or description and reads the tool', () => {
    expect(appPromptOf({ command: fixture.command, description: fixture.description })).toEqual({ tool: 'GITHUB_CREATE_AN_ISSUE', argsTruncated: false })
    expect(appPromptOf({ description: fixture.description })).toEqual({ tool: null, argsTruncated: false })
    expect(appPromptOf({ surface: 'mcp-trust/crew_apps', command: 'x' })).toEqual({ tool: null, argsTruncated: false })
  })

  it("recognises a reworded prompt that still names server 'crew_apps'", () => {
    expect(appPromptOf({ command: "Run a tool on server 'crew_apps' now" })).toEqual({ tool: null, argsTruncated: false })
    expect(appPromptOf({ description: "Allow UNTRUSTED server 'crew_apps' to act?" })).toEqual({ tool: null, argsTruncated: false })
  })

  it('flags arguments Hermes cut at 1,200 characters', () => {
    const command = `MCP tool 'T' on UNTRUSTED server 'crew_apps' wants to run.\n\nArguments:\n${'a'.repeat(1_200)}${ARGS_TRUNCATED}`
    expect(appPromptOf({ command })).toEqual({ tool: 'T', argsTruncated: true })
  })

  it('ignores prompts of other MCP servers and ordinary commands', () => {
    expect(appPromptOf({ command: "MCP tool 'T' on UNTRUSTED server 'other' wants to run.", description: "Server 'other' is configured 'trust: untrusted'." })).toBeNull()
    expect(appPromptOf({ command: 'rm -r /tmp/x', description: 'delete' })).toBeNull()
    expect(appPromptOf({})).toBeNull()
  })
})

describe('appChoices', () => {
  it('keeps only once and deny', () => {
    expect(appChoices(['once', 'session', 'always', 'deny'])).toEqual(['once', 'deny'])
    expect(appChoices(fixture.choices)).toEqual(['once', 'deny'])
    expect(appChoices(['deny', 'once'])).toEqual(['deny', 'once'])
    expect(appChoices(['always'])).toEqual(['once', 'deny'])
    expect(appChoices(undefined)).toEqual(['once', 'deny'])
  })
})
