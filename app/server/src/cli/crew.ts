#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { loadConfig } from '../config.js'

const USAGE = 'usage: crew login    print a one-use sign-in link (valid 60 s)\n'

async function login(): Promise<number> {
  const config = loadConfig(process.env)
  const admin = await readFile(join(config.stateDir, 'admin-secret'))
  const res = await fetch(`http://${config.allowedHosts[0]}/crew/admin/login-ticket`, {
    method: 'POST',
    headers: { 'X-Crew-Admin': admin.toString('hex') }
  })
  if (!res.ok) {
    process.stderr.write(`crew login failed: HTTP ${res.status}. Is the crew service running?\n`)
    return 1
  }
  const { url } = (await res.json()) as { url: string }
  process.stdout.write(`Open this link in your browser within 60 seconds:\n  ${url}\n`)
  return 0
}

async function main(argv: readonly string[]): Promise<number> {
  if (argv[0] === 'login') return login()
  process.stderr.write(USAGE)
  return 2
}

main(process.argv.slice(2))
  .then(code => process.exit(code))
  .catch(error => {
    process.stderr.write(`crew: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
