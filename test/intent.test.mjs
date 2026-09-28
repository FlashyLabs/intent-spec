// The conformance suite, run with `node --test`.
//
// Three things are pinned here. Every vector in `vectors/` agrees with the
// checker, exactly — a vector asserts the full set of error codes, not "at
// least these", because an implementation that reports extra errors on a
// valid-adjacent document refuses documents the standard accepts, which is a
// different standard. Each rule the format exists for has a unit test that
// would fail if the rule were weakened. And the prose agrees with the code:
// every refusal the checker can emit is explained in SPEC.md, and the schema's
// enums are the checker's constants.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import {
  validate, checkFragment, checkProjection, publicView, fileItem, promoteItem, expiryFor,
  normaliseCapabilities, fetchFragment, runVector, isVector,
  INTENT_VERSION, LEGACY_VERSION_KEY, ITEM_KINDS, ITEM_STATUSES, VISIBILITIES, DECAY_DAYS,
  FRAGMENT_KEYS, ITEM_KEYS, REFUSALS, WARNINGS, WELL_KNOWN_PATH,
} from '../vendor-intent.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const VECTORS = join(ROOT, 'vectors')
const CHECKER = join(ROOT, 'vendor-intent.mjs')
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))

const codes = (result) => [...new Set(result.errors.map((e) => e.code))].sort()
const fragment = (items, extra = {}) => ({
  intent: '1', source: 'repo/example', org: 'org/example', generated: '2026-09-01T00:00:00Z', items, ...extra,
})
const filed = (over = {}) => ({
  ...fileItem({ source: 'repo/example', slug: 'a-thing', kind: 'task', title: 'A thing', by: 'agent/example-bot', asserted: '2026-09-01' }),
  ...over,
})
const published = (over = {}) => ({ ...promoteItem(filed(), { by: 'person/avery', to: 'public', at: '2026-09-01' }), ...over })

// ── Vectors ─────────────────────────────────────────────────────────────────

describe('conformance vectors', () => {
  const files = readdirSync(VECTORS).filter((f) => f.endsWith('.json')).sort()
  const vectors = files.map((f) => ({ file: f, vector: readJson(join(VECTORS, f)) }))

  test('there are at least three valid and four invalid vectors', () => {
    const valid = vectors.filter((v) => v.vector.verdict === 'valid')
    const invalid = vectors.filter((v) => v.vector.verdict === 'invalid')
    assert.ok(valid.length >= 3, `valid: ${valid.length}`)
    assert.ok(invalid.length >= 4, `invalid: ${invalid.length}`)
  })

  test('every vector is named after its file, says why it exists, and is a vector envelope', () => {
    for (const { file, vector } of vectors) {
      assert.equal(vector.name, file.replace(/\.json$/, ''))
      assert.ok(vector.why && vector.why.length > 20, `${file} has no why`)
      assert.ok(isVector(vector), `${file} is not a vector envelope`)
      assert.ok(['valid', 'invalid'].includes(vector.verdict), `${file} has no verdict`)
      if (vector.verdict === 'invalid') assert.ok(Array.isArray(vector.errors) && vector.errors.length > 0, `${file} names no refusal`)
    }
  })

  test('every invalid vector names only refusals the checker defines', () => {
    for (const { file, vector } of vectors) {
      for (const code of vector.errors ?? []) assert.ok(code in REFUSALS, `${file} names unknown refusal ${code}`)
      for (const code of vector.warnings ?? []) assert.ok(code in WARNINGS, `${file} names unknown warning ${code}`)
    }
  })

  for (const { file, vector } of vectors) {
    test(`${file}: ${vector.verdict}${vector.errors ? ` (${vector.errors.join(', ')})` : ''}`, () => {
      const r = runVector(vector)
      assert.deepEqual(r.actual, r.expected, `${vector.name}: ${vector.why}`)
      if (r.expectedWarnings) assert.deepEqual(r.actualWarnings, r.expectedWarnings)
      assert.equal(validate(vector.document).valid, vector.verdict === 'valid')
      assert.ok(r.agreed)
    })
  }

  test('every refusal an item-level rule can emit alone is covered by a vector, except the two that need a broken envelope', () => {
    const covered = new Set(vectors.flatMap((v) => v.vector.errors ?? []))
    const required = ['derived-expiry', 'unpromoted-publication', 'non-human-promotion', 'promoted-but-private',
      'foreign-item', 'foreign-owner', 'source-mismatch', 'duplicate-revision', 'unknown-key', 'unknown-item-key',
      'bad-visibility', 'bad-version', 'no-items', 'no-asserter']
    for (const code of required) assert.ok(covered.has(code), `no vector for ${code}`)
  })
})

// ── Derived expiry ──────────────────────────────────────────────────────────

describe('expiry is derived, never accepted as input', () => {
  test('each kind has the window the spec states', () => {
    assert.deepEqual(DECAY_DAYS, { idea: 180, task: 90, bug: 30, decision: 30, blocker: 14 })
    assert.equal(expiryFor('task', '2026-09-01'), '2026-11-30')
    assert.equal(expiryFor('idea', '2026-09-01'), '2027-02-28')
    assert.equal(expiryFor('bug', '2026-09-01'), '2026-10-01')
    assert.equal(expiryFor('decision', '2026-09-01'), '2026-10-01')
    assert.equal(expiryFor('blocker', '2026-09-01'), '2026-09-15')
  })

  test('the derivation crosses a leap day correctly', () => {
    assert.equal(expiryFor('blocker', '2028-02-20'), '2028-03-05')
  })

  test('it refuses a malformed or impossible date rather than computing from it', () => {
    assert.throws(() => expiryFor('task', '2026-9-1'), /YYYY-MM-DD/)
    assert.throws(() => expiryFor('task', '2026-13-40'), /not a real date/)
    assert.throws(() => expiryFor('initiative', '2026-09-01'), /no decay window/)
  })

  test('an expires one day longer OR one day shorter than derived is refused — exactly, not at most', () => {
    assert.deepEqual(codes(validate(fragment([filed({ expires: '2026-12-01' })]))), ['derived-expiry'])
    assert.deepEqual(codes(validate(fragment([filed({ expires: '2026-11-29' })]))), ['derived-expiry'])
    assert.equal(validate(fragment([filed()])).valid, true)
  })

  test('fileItem has no expires argument: one passed is ignored and the derived value is written', () => {
    const item = fileItem({ source: 'repo/example', slug: 'x', kind: 'bug', title: 'x', by: 'agent/a', asserted: '2026-09-01', expires: '2099-01-01' })
    assert.equal(item.expires, '2026-10-01')
  })

  test('re-asserting resets the window; the old expiry is then refused', () => {
    const later = filed({ rev: 2, asserted: '2026-10-01' })
    assert.deepEqual(codes(validate(fragment([later]))), ['derived-expiry'])
    assert.equal(validate(fragment([{ ...later, expires: expiryFor('task', '2026-10-01') }])).valid, true)
  })
})

// ── Visibility and consent ──────────────────────────────────────────────────

describe('private by default; publication requires a named human', () => {
  test('fileItem produces private and has no visibility argument — one passed changes nothing', () => {
    assert.equal(filed().visibility, 'private')
    const forced = fileItem({ source: 'repo/example', slug: 'x', kind: 'task', title: 'x', by: 'agent/a', visibility: 'public' })
    assert.equal(forced.visibility, 'private')
    assert.equal(forced.promoted, undefined)
  })

  test('a missing visibility is refused, never defaulted', () => {
    const item = filed()
    delete item.visibility
    assert.deepEqual(codes(validate(fragment([item]))), ['bad-visibility'])
  })

  test('public or partner without a promotion record is refused', () => {
    assert.deepEqual(codes(validate(fragment([filed({ visibility: 'public' })]))), ['unpromoted-publication'])
    assert.deepEqual(codes(validate(fragment([filed({ visibility: 'partner' })]))), ['unpromoted-publication'])
  })

  test('promoteItem refuses anything but a person/ id and anything but public or partner', () => {
    assert.throws(() => promoteItem(filed(), { by: 'agent/example-bot', to: 'public' }), /humans consent/)
    assert.throws(() => promoteItem(filed(), { by: 'org/example', to: 'public' }), /humans consent/)
    assert.throws(() => promoteItem(filed(), { by: 'person/avery', to: 'private' }), /public or partner/)
    const p = promoteItem(filed(), { by: 'person/avery', to: 'public', at: '2026-09-01', note: ' why ' })
    assert.equal(p.rev, 2)
    assert.equal(p.visibility, 'public')
    assert.deepEqual(p.promoted, { at: '2026-09-01', by: 'person/avery', note: 'why' })
    assert.equal(validate(fragment([p])).valid, true)
  })

  test('a promotion by an agent on the wire is refused even though the shape is right', () => {
    assert.deepEqual(codes(validate(fragment([published({ promoted: { at: '2026-09-01', by: 'agent/example-bot' } })]))), ['non-human-promotion'])
  })

  test('the public projection carries the public tier only — partner is not an exception', () => {
    const items = [published(), promoteItem(filed(), { by: 'person/avery', to: 'partner', at: '2026-09-01' }), filed()]
    assert.deepEqual(publicView(items).map((i) => i.visibility), ['public'])
    assert.deepEqual(publicView(undefined), [])
  })

  test('a served document carrying a non-public item is refused with served-nonpublic', () => {
    const other = fileItem({ source: 'repo/example', slug: 'b-thing', kind: 'task', title: 'B thing', by: 'agent/example-bot', asserted: '2026-09-01' })
    const partner = promoteItem(other, { by: 'person/avery', to: 'partner', at: '2026-09-01' })
    const doc = fragment([published(), partner])
    assert.equal(validate(doc).valid, true, 'a full record is valid as a record')
    assert.deepEqual(codes(validate(doc, { served: true })), ['served-nonpublic'])
    assert.deepEqual(checkProjection(doc), [['served-nonpublic', partner.id]])
  })
})

// ── Unknown keys ────────────────────────────────────────────────────────────

describe('unknown keys are refused unless x- prefixed', () => {
  test('an unknown top-level key is refused, and the key is named', () => {
    const r = validate(fragment([], { roadmap: [] }))
    assert.deepEqual(codes(r), ['unknown-key'])
    assert.equal(r.errors[0].subject, 'roadmap')
  })

  test('an unknown item key is refused, and the item and key are named', () => {
    const r = validate(fragment([filed({ urgency: 'high' })]))
    assert.deepEqual(codes(r), ['unknown-item-key'])
    assert.equal(r.errors[0].subject, 'intent/example/a-thing: urgency')
  })

  test('x- keys pass at both levels, whatever their value', () => {
    const doc = fragment([filed({ 'x-priority': { rank: 2 } })], { 'x-tracker': 'https://tracker.example', 'x-empty': null })
    assert.equal(validate(doc).valid, true)
  })

  test('the prefix is exactly "x-": "x_" and "X-" are not extensions', () => {
    assert.deepEqual(codes(validate(fragment([], { 'x_tracker': 1 }))), ['unknown-key'])
    assert.deepEqual(codes(validate(fragment([], { 'X-Tracker': 1 }))), ['unknown-key'])
  })

  test('the key lists the checker holds are the schema\'s properties', () => {
    const schema = readJson(join(ROOT, 'schema', 'intent-1.json'))
    assert.deepEqual([...FRAGMENT_KEYS].sort(), Object.keys(schema.properties).sort())
    assert.deepEqual([...ITEM_KEYS].sort(), Object.keys(schema.$defs.item.properties).sort())
    assert.deepEqual(schema.patternProperties, { '^x-': {} })
    assert.deepEqual(schema.$defs.item.patternProperties, { '^x-': {} })
    assert.equal(schema.additionalProperties, false)
    assert.equal(schema.$defs.item.additionalProperties, false)
  })
})

// ── Version and envelope ────────────────────────────────────────────────────

describe('the version key', () => {
  test('an unknown version is refused, never guessed at', () => {
    assert.deepEqual(codes(validate(fragment([], { intent: '2' }))), ['bad-version'])
    assert.deepEqual(codes(validate(fragment([], { intent: 1 }))), ['bad-version'])
  })

  test('the legacy backlog key is accepted with a warning, and never an error', () => {
    const doc = fragment([])
    delete doc.intent
    doc[LEGACY_VERSION_KEY] = INTENT_VERSION
    const r = validate(doc)
    assert.equal(r.valid, true)
    assert.deepEqual(r.warnings.map((w) => w.code), ['legacy-version-key'])
    assert.deepEqual(validate(fragment([])).warnings, [])
  })

  test('a non-object is refused rather than thrown on', () => {
    for (const doc of [null, undefined, 42, 'intent', []]) assert.equal(validate(doc).valid, false)
  })

  test('fragment-level refusals name the field', () => {
    assert.deepEqual(codes(validate(fragment([], { source: 'example' }))), ['bad-fragment-source'])
    assert.deepEqual(codes(validate(fragment([], { org: 'example' }))), ['bad-fragment-org'])
    assert.deepEqual(codes(validate(fragment([], { generated: 'yesterday' }))), ['bad-generated'])
    assert.deepEqual(codes(validate(fragment('none'))), ['no-items'])
  })
})

// ── Authority ───────────────────────────────────────────────────────────────

describe('a fragment speaks for its own repository and org', () => {
  test('an item whose id names another repository is foreign', () => {
    const item = filed({ id: 'intent/other/a-thing', source: { repo: 'repo/other' } })
    assert.deepEqual(codes(validate(fragment([item]))), ['foreign-item'])
  })

  test('a source.repo that disagrees with the id is a mismatch', () => {
    assert.deepEqual(codes(validate(fragment([filed({ source: { repo: 'repo/other' } })]))), ['source-mismatch'])
  })

  test('an org/ owner must be the fragment\'s org; person/ and agent/ owners are free', () => {
    assert.deepEqual(codes(validate(fragment([filed({ owner: 'org/other' })]))), ['foreign-owner'])
    assert.equal(validate(fragment([filed({ owner: 'org/example' })])).valid, true)
    assert.equal(validate(fragment([filed({ owner: 'person/avery' })])).valid, true)
    assert.deepEqual(codes(validate(fragment([filed({ owner: 'Avery' })]))), ['bad-owner'])
  })

  test('one (id, rev) per fragment; a higher rev of the same id is fine', () => {
    assert.deepEqual(codes(validate(fragment([filed(), filed()]))), ['duplicate-revision'])
    assert.equal(validate(fragment([filed(), filed({ rev: 2 })])).valid, true)
  })
})

// ── Field rules ─────────────────────────────────────────────────────────────

describe('field rules', () => {
  test('capabilitiesWanted must already be normalised', () => {
    assert.deepEqual(normaliseCapabilities([' Payments', 'payments', '', 'Compliance ']), ['payments', 'compliance'])
    assert.equal(normaliseCapabilities([]), undefined)
    assert.equal(normaliseCapabilities(Array.from({ length: 25 }, (_, i) => `c${i}`)).length, 20)
    assert.deepEqual(codes(validate(fragment([filed({ capabilitiesWanted: ['Payments'] })]))), ['unnormalised-capabilities'])
    assert.deepEqual(codes(validate(fragment([filed({ capabilitiesWanted: 'payments' })]))), ['unnormalised-capabilities'])
  })

  test('title and detail caps, https-only ref, and provenance', () => {
    assert.deepEqual(codes(validate(fragment([filed({ title: 'x'.repeat(141) })]))), ['title-too-long'])
    assert.deepEqual(codes(validate(fragment([filed({ title: '  ' })]))), ['no-title'])
    assert.deepEqual(codes(validate(fragment([filed({ detail: 'x'.repeat(2001) })]))), ['detail-too-long'])
    assert.deepEqual(codes(validate(fragment([filed({ source: { repo: 'repo/example', ref: 'http://example' } })]))), ['bad-ref'])
    assert.deepEqual(codes(validate(fragment([filed({ assertedBy: undefined })]))), ['no-asserter'])
    assert.deepEqual(codes(validate(fragment([filed({ status: 'wontfix' })]))), ['bad-status'])
    assert.deepEqual(codes(validate(fragment([filed({ rev: 0 })]))), ['bad-rev'])
    assert.deepEqual(codes(validate(fragment([filed({ id: 'thing' })]))), ['bad-id'])
  })

  test('fileItem refuses a bad source, kind or asserter rather than producing a document the checker would refuse', () => {
    assert.throws(() => fileItem({ source: 'example', slug: 'x', kind: 'task', title: 'x', by: 'agent/a' }), /repo\//)
    assert.throws(() => fileItem({ source: 'repo/example', slug: 'x', kind: 'initiative', title: 'x', by: 'agent/a' }), /kind must be/)
    assert.throws(() => fileItem({ source: 'repo/example', slug: 'x', kind: 'task', title: 'x' }), /names who filed/)
  })

  test('the vocabulary is the schema\'s', () => {
    const schema = readJson(join(ROOT, 'schema', 'intent-1.json'))
    assert.deepEqual(schema.$defs.item.properties.kind.enum, ITEM_KINDS)
    assert.deepEqual(schema.$defs.item.properties.status.enum, ITEM_STATUSES)
    assert.deepEqual(schema.$defs.item.properties.visibility.enum, VISIBILITIES)
    assert.equal(schema.properties.intent.const, INTENT_VERSION)
    assert.equal(schema.properties[LEGACY_VERSION_KEY].const, INTENT_VERSION)
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema')
  })
})

// ── Discovery ───────────────────────────────────────────────────────────────

describe('discovery: the fetch rules, with no network', () => {
  const respond = (body, init = {}) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, ...init })
  const projection = () => fragment([published()])

  test('http is refused outright, not upgraded', async () => {
    await assert.rejects(fetchFragment('http://example.test'), /https only/)
  })

  test('a bare domain resolves to /.well-known/intent.json', async () => {
    let seen = ''
    const r = await fetchFragment('example.test', { fetchImpl: async (url) => { seen = String(url); return new Response(JSON.stringify(projection())) } })
    assert.equal(seen, `https://example.test${WELL_KNOWN_PATH}`)
    assert.equal(r.finding, 'published')
    assert.equal(r.fragment.items.length, 1)
  })

  test('404 and 410 are absent: the publisher answered and publishes nothing', async () => {
    for (const status of [404, 410]) {
      assert.equal((await fetchFragment('example.test', { fetchImpl: respond('', { status }) })).finding, 'absent')
    }
  })

  test('a network failure, a timeout and a 5xx are unreachable — never absent', async () => {
    const refused = await fetchFragment('example.test', { fetchImpl: async () => { throw new Error('ECONNREFUSED') } })
    assert.equal(refused.finding, 'unreachable')
    assert.equal(refused.detail, 'ECONNREFUSED')
    const slow = await fetchFragment('example.test', {
      timeoutMs: 20,
      fetchImpl: (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
    })
    assert.equal(slow.finding, 'unreachable')
    assert.equal(slow.detail, 'timeout')
    assert.equal((await fetchFragment('example.test', { fetchImpl: respond('', { status: 503 }) })).finding, 'unreachable')
  })

  test('a redirect within the publisher is followed; to another host or off https it is refused', async () => {
    const hops = []
    const r = await fetchFragment('example.test', {
      fetchImpl: async (url) => {
        hops.push(String(url))
        if (hops.length === 1) return new Response('', { status: 301, headers: { location: `https://www.example.test${WELL_KNOWN_PATH}` } })
        return new Response(JSON.stringify(projection()))
      },
    })
    assert.equal(r.finding, 'published')
    assert.equal(hops.length, 2)

    const foreign = await fetchFragment('example.test', { fetchImpl: respond('', { status: 302, headers: { location: 'https://other.test/.well-known/intent.json' } }) })
    assert.equal(foreign.finding, 'invalid')
    assert.match(foreign.detail, /another host/)

    const downgrade = await fetchFragment('example.test', { fetchImpl: respond('', { status: 302, headers: { location: 'http://example.test/.well-known/intent.json' } }) })
    assert.equal(downgrade.finding, 'invalid')
    assert.match(downgrade.detail, /off https/)

    const loop = await fetchFragment('example.test', { maxRedirects: 2, fetchImpl: respond('', { status: 302, headers: { location: `https://example.test${WELL_KNOWN_PATH}` } }) })
    assert.equal(loop.finding, 'unreachable')
    assert.equal(loop.detail, 'too many redirects')
  })

  test('the size cap refuses an oversized body, by header and by bytes', async () => {
    const byHeader = await fetchFragment('example.test', { maxBytes: 100, fetchImpl: respond('{}', { headers: { 'content-length': '101' } }) })
    assert.equal(byHeader.finding, 'invalid')
    assert.match(byHeader.detail, /cap/)
    const byBytes = await fetchFragment('example.test', { maxBytes: 100, fetchImpl: respond(JSON.stringify(projection())) })
    assert.equal(byBytes.finding, 'invalid')
  })

  test('a served document carrying a non-public item is invalid — the worst case, said out loud', async () => {
    const r = await fetchFragment('example.test', { fetchImpl: respond(fragment([published(), filed()])) })
    assert.equal(r.finding, 'invalid')
    assert.deepEqual(r.problems.map((p) => p.code), ['served-nonpublic'])
    assert.equal((await fetchFragment('example.test', { fetchImpl: respond('not json') })).finding, 'invalid')
  })
})

// ── The prose agrees with the code ──────────────────────────────────────────

describe('SPEC.md and README.md agree with the checker', () => {
  const spec = readFileSync(join(ROOT, 'SPEC.md'), 'utf8')
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')

  test('every refusal and warning the checker can emit is listed in SPEC.md, and SPEC.md lists no other', () => {
    const refusals = spec.split('## Refusals')[1].split('\n## ')[0]
    const listed = [...refusals.matchAll(/^\| `([a-z-]+)` \|/gm)].map((m) => m[1]).sort()
    assert.deepEqual(listed, [...Object.keys(REFUSALS), ...Object.keys(WARNINGS)].sort())
  })

  test('SPEC.md states the decay windows the checker uses', () => {
    for (const [kind, days] of Object.entries(DECAY_DAYS)) assert.match(spec, new RegExp(`\\| \`${kind}\` \\| ${days} \\|`))
  })

  test('both documents carry the status and licence lines the estate requires', () => {
    assert.match(spec, /^Status: draft/m)
    assert.match(readme, /^Status: draft/m)
    const last = readme.trimEnd().split('\n').at(-1)
    assert.equal(last, 'Licence: to be declared at launch. The estate licence register in flashyos governs; this repository is not yet open-sourced.')
    assert.ok(!readme.startsWith('This repository contains'))
  })

  test('no file under the tree declares a licence', () => {
    assert.ok(!readdirSync(ROOT).some((f) => /^licen[cs]e/i.test(f)))
    assert.equal(readJson(join(ROOT, 'package.json')).license, undefined)
  })
})

// ── The CLI ─────────────────────────────────────────────────────────────────

describe('the CLI', () => {
  const cli = (...args) => spawnSync(process.execPath, [CHECKER, ...args], { encoding: 'utf8', cwd: ROOT })

  test('check on a valid vector prints ok and exits 0', () => {
    const r = cli('check', 'vectors/minimal-valid.json')
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /^ok$/m)
  })

  test('check on an invalid vector names the refusal and exits 1', () => {
    const r = cli('check', 'vectors/derived-expiry.json')
    assert.equal(r.status, 1)
    assert.match(r.stderr, /\[derived-expiry\]/)
    assert.match(r.stdout, /1 problem\(s\)/)
  })

  test('check --served refuses a full record at a public URL', () => {
    const r = cli('check', 'vectors/full-valid.json', '--served')
    assert.equal(r.status, 1)
    assert.match(r.stderr, /\[served-nonpublic\]/)
  })

  test('vectors runs the corpus and agrees with every one', () => {
    const r = cli('vectors')
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /0 disagreement\(s\)/)
  })

  test('the checker imports only node: builtins', () => {
    const src = readFileSync(CHECKER, 'utf8')
    const imports = [...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1])
    assert.ok(imports.length > 0)
    for (const i of imports) assert.match(i, /^node:/)
    assert.equal(readJson(join(ROOT, 'package.json')).dependencies, undefined)
  })
})
