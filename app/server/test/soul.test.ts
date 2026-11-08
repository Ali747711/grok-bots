import { describe, expect, it } from 'vitest'

import { composeSoul } from '../src/bots/soul.js'

describe('composeSoul', () => {
  it('composes the soul with one name and no Role line', () => {
    expect(composeSoul({ name: 'scout', title: 'Researcher', mission: 'Find papers' })).toBe(
      '# Researcher\n\n**Mission:** Find papers\n\nYou are Researcher, a persistent named agent (profile `scout`) on this machine.\nYou keep your own memory, skills, and conversation history across sessions.')
  })

  it('composes the official form (separate role) when a role is given', () => {
    expect(composeSoul({ name: 'scout', title: 'Scout', role: 'Researcher', mission: 'Find papers' })).toBe(
      '# Scout\n\n**Role:** Researcher\n**Mission:** Find papers\n\nYou are Scout, a persistent named agent (profile `scout`) on this machine.\nYou keep your own memory, skills, and conversation history across sessions.')
    // The official client's single title doubles as the role: byte-identical to its composeSoul.
    expect(composeSoul({ name: 'scout', title: 'Researcher', role: 'Researcher', mission: 'Find papers' })).toBe(
      '# Researcher\n\n**Role:** Researcher\n**Mission:** Find papers\n\nYou are Researcher, a persistent named agent (profile `scout`) on this machine.\nYou keep your own memory, skills, and conversation history across sessions.')
  })

  it('omits Role and Mission when empty and Title-cases the name', () => {
    const soul = composeSoul({ name: 'inbox-triage', title: '', mission: '' })
    expect(soul).toBe('# Inbox Triage\n\n\nYou are Inbox Triage, a persistent named agent (profile `inbox-triage`) on this machine.\nYou keep your own memory, skills, and conversation history across sessions.')
    expect(soul).not.toMatch(/Role:|Mission:/)
  })

  // Ported from soul.test.ts: with the server injecting the protocol, no messaging section is added.
  it('never adds the messaging-protocol section', () => {
    expect(composeSoul({ name: 'newbot', title: 'T', mission: 'D' })).not.toMatch(/## Messaging other agents/)
  })
})
