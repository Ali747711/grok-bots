#!/usr/bin/env node
// Vendor Hermes's dependency-free shared protocol client from a pinned commit.
//   node app/scripts/vendor-hermes.mjs           copy json-rpc-gateway.ts + its relative-import closure
//   node app/scripts/vendor-hermes.mjs --check   verify vendored files still match VENDORED_FROM.json
// Re-vendor only after checking Crew against the new Hermes version (design §6.1).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PINNED_COMMIT = '2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19'
const HERMES_REPO = join(homedir(), '.hermes', 'hermes-agent')
const SOURCE_DIR = 'apps/shared/src'
const ENTRY = 'json-rpc-gateway.ts'
const OUT_DIR = fileURLToPath(new URL('../server/src/vendor/hermes/', import.meta.url))
// The browser bundle gets its own byte-identical copy so web never imports from server.
const WEB_OUT_DIR = fileURLToPath(new URL('../web/src/vendor/hermes/', import.meta.url))
const OUT_DIRS = [OUT_DIR, WEB_OUT_DIR]
const MANIFEST = 'VENDORED_FROM.json'

const sha256 = data => createHash('sha256').update(data).digest('hex')

function gitShow(path) {
  return execFileSync('git', ['-C', HERMES_REPO, 'show', `${PINNED_COMMIT}:${SOURCE_DIR}/${path}`], { encoding: 'utf8' })
}

/** Relative imports/re-exports (`from './x.js'`) mapped to their `.ts` source paths. */
function relativeImports(source, fromFile) {
  const specs = [...source.matchAll(/from\s+'(\.{1,2}\/[^']+)'/g)].map(m => m[1])
  return specs.map(spec => normalize(join(dirname(fromFile), spec.replace(/\.js$/, '.ts'))))
}

async function vendor() {
  const files = new Map()
  const queue = [ENTRY]
  while (queue.length) {
    const file = queue.shift()
    if (files.has(file) || file.endsWith('.test.ts')) continue
    const source = gitShow(file)
    files.set(file, source)
    queue.push(...relativeImports(source, file))
  }
  const hashes = {}
  for (const [file, source] of files) hashes[file] = sha256(source)
  const manifest = JSON.stringify({ commit: PINNED_COMMIT, source: SOURCE_DIR, files: Object.fromEntries(Object.entries(hashes).sort()) }, null, 2) + '\n'
  for (const outDir of OUT_DIRS) {
    await rm(outDir, { recursive: true, force: true })
    for (const [file, source] of [...files].sort()) {
      await mkdir(dirname(join(outDir, file)), { recursive: true })
      await writeFile(join(outDir, file), source)
    }
    await writeFile(join(outDir, MANIFEST), manifest)
  }
  return Object.keys(hashes).sort()
}

/** Compare every vendored file to its recorded hash. */
export async function checkVendored(dir = OUT_DIR) {
  const manifest = JSON.parse(await readFile(join(dir, MANIFEST), 'utf8'))
  const mismatches = []
  for (const [file, expected] of Object.entries(manifest.files)) {
    const actual = await readFile(join(dir, file)).then(sha256, () => null)
    if (actual !== expected) mismatches.push(file)
  }
  return { ok: mismatches.length === 0, mismatches }
}

/** Check every output copy; mismatches are prefixed with the copy they belong to. */
export async function checkAllVendored(dirs = OUT_DIRS) {
  const mismatches = []
  for (const dir of dirs) {
    const r = await checkVendored(dir).catch(() => ({ ok: false, mismatches: [MANIFEST] }))
    mismatches.push(...r.mismatches.map(f => `${dir}${f}`))
  }
  return { ok: mismatches.length === 0, mismatches }
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])
if (invokedDirectly) {
  const run = process.argv.includes('--check')
    ? checkAllVendored().then(r => {
      process.stdout.write(r.ok ? 'vendored files match\n' : `vendored files changed: ${r.mismatches.join(', ')}\n`)
      process.exit(r.ok ? 0 : 1)
    })
    : vendor().then(files => process.stdout.write(`vendored ${files.length} files from ${PINNED_COMMIT}:\n  ${files.join('\n  ')}\n`))
  run.catch(e => { process.stderr.write(`vendor-hermes: ${e.message}\n`); process.exit(1) })
}
