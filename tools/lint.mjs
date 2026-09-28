#!/usr/bin/env node
// `node --check` over every .mjs in the tree, this file included.
//
// A syntax error in a file nothing imports is invisible to `npm test`; this
// walks the repository rather than holding a list of paths, because a list of
// the files we happen to have reports every file we add later as fine.

import { readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKIP = new Set(['.git', 'node_modules'])

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* walk(path)
    else if (name.endsWith('.mjs')) yield path
  }
}

let failed = 0
let count = 0
for (const file of walk(ROOT)) {
  count++
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  } catch (error) {
    failed++
    console.error(`✗ ${file}\n${error.stderr?.toString() ?? error.message}`)
  }
}
console.log(`${count} .mjs file(s) checked, ${failed} failed`)
process.exit(failed || count === 0 ? 1 : 0)
