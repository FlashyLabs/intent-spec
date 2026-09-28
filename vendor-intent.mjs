#!/usr/bin/env node
// intent/1 — the dependency-free conformance checker.
//
// This file is the whole toolchain a publisher or a reader needs: copy it into
// any repository, run it with bare node, and learn whether a document is a
// permitted intent/1 fragment. It imports only `node:` builtins, so it needs no
// install, and it is a faithful port of the validation rules in the reference
// implementation (FlashyLabs/intentmesh, `vendor-intentmesh.mjs` and
// `src/validate.ts`). Where this file and that one disagree about a document,
// one of them is wrong and SPEC.md in this repository says which.
//
// The rules the format exists for, stated once here and enforced below:
//
//   expiry is derived        `expires` must be exactly asserted + the kind's
//                            window. Not "no longer than" — exactly. A writer
//                            who can shorten it can lengthen it.
//   filed is not published   an item is private until a NAMED HUMAN promotes
//                            it. `fileItem` has no visibility argument, and a
//                            public item with no `promoted` record is refused.
//   refuse, never guess      an unknown version, an unknown key, a missing
//                            visibility — each is a refusal with a code, never
//                            a default silently filled in. Extension keys are
//                            `x-` prefixed and nothing else is tolerated.
//
//   node vendor-intent.mjs check <file.json> [--served]   validate a document (or a conformance vector's document)
//   node vendor-intent.mjs vectors [dir]                  run every conformance vector in a directory
//   node vendor-intent.mjs verify <domain|https-url>      fetch a publisher's public projection the way a stranger would

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// ── Vocabulary ──────────────────────────────────────────────────────────────

export const INTENT_VERSION = '1'
export const LEGACY_VERSION_KEY = 'backlog'
export const ITEM_KINDS = ['idea', 'task', 'bug', 'blocker', 'decision']
export const ITEM_STATUSES = ['open', 'doing', 'blocked', 'done', 'dropped']
export const VISIBILITIES = ['public', 'partner', 'private']
export const DECAY_DAYS = { idea: 180, task: 90, bug: 30, decision: 30, blocker: 14 }
export const WELL_KNOWN_PATH = '/.well-known/intent.json'
export const MAX_TITLE = 140
export const MAX_DETAIL = 2000
export const MAX_CAPABILITIES = 20

/** The keys version 1 defines. Anything else at that level is `x-` prefixed or refused. */
export const FRAGMENT_KEYS = ['intent', LEGACY_VERSION_KEY, 'source', 'org', 'generated', 'items']
export const ITEM_KEYS = [
  'id', 'rev', 'kind', 'status', 'title', 'detail', 'owner', 'source',
  'capabilitiesWanted', 'promoted', 'asserted', 'assertedBy', 'expires', 'visibility',
]
export const isExtensionKey = (key) => typeof key === 'string' && key.startsWith('x-')

const DAY = 86_400_000
const ITEM_ID_RE = /^(intent|backlog)\/[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/
const NODE_ID_RE = /^[a-z]+\/[a-z0-9][a-z0-9._-]*$/
const REPO_RE = /^repo\/[a-z0-9][a-z0-9._-]*$/
const ORG_RE = /^org\/[a-z0-9][a-z0-9._-]*$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export const today = (now = new Date()) => now.toISOString().slice(0, 10)

/**
 * The one expiry: `asserted` plus this kind's window, as YYYY-MM-DD.
 *
 * Throws on a malformed date rather than returning a plausible wrong answer —
 * an expiry computed from garbage would pass validation, because validation
 * checks against this same function.
 */
export function expiryFor(kind, asserted) {
  if (!DATE_RE.test(asserted)) throw new TypeError(`asserted "${asserted}" is not a YYYY-MM-DD date`)
  const days = DECAY_DAYS[kind]
  if (days === undefined) throw new TypeError(`no decay window for kind "${kind}"`)
  const at = Date.parse(`${asserted}T00:00:00Z`)
  if (Number.isNaN(at)) throw new TypeError(`asserted "${asserted}" is not a real date`)
  return new Date(at + days * DAY).toISOString().slice(0, 10)
}

/** Trimmed, lowercased, de-duplicated, capped at 20. `undefined` when nothing survives. */
export function normaliseCapabilities(input) {
  if (!input) return undefined
  const out = []
  const seen = new Set()
  for (const raw of input) {
    const clean = String(raw).trim().toLowerCase()
    if (!clean || seen.has(clean)) continue
    seen.add(clean)
    out.push(clean)
    if (out.length === MAX_CAPABILITIES) break
  }
  return out.length ? out : undefined
}

const repoOfItem = (id) => {
  const parts = String(id ?? '').split('/')
  return parts.length === 3 ? `repo/${parts[1]}` : undefined
}

// ── Refusals ────────────────────────────────────────────────────────────────
//
// Every code the checker can emit, with the reason. SPEC.md's "Refusals"
// section is this table in prose, and test/intent.test.mjs asserts the two
// name the same set — a refusal the spec does not explain is a refusal an
// adopter cannot fix.

export const REFUSALS = {
  'bad-version': 'neither "intent" nor "backlog" is "1" — an unknown version is refused, never guessed at',
  'unknown-key': 'a top-level key version 1 does not define — extensions are "x-" prefixed; anything else is refused rather than carried silently',
  'bad-fragment-source': 'source is not repo/<slug>',
  'bad-fragment-org': 'org is not org/<slug>',
  'bad-generated': 'generated is not a timestamp',
  'no-items': 'a fragment without an items array is not a fragment',
  'not-an-item': 'an entry in items is not an object',
  'unknown-item-key': 'an item key version 1 does not define — extensions are "x-" prefixed; anything else is refused',
  'bad-id': 'id is not intent/<repo>/<slug> (or backlog/<repo>/<slug> from before the rename)',
  'bad-rev': 'rev is not an integer from 1',
  'bad-kind': 'kind is not one of idea, task, bug, blocker, decision',
  'bad-status': 'status is not one of open, doing, blocked, done, dropped',
  'no-title': 'an item with no title cannot be acted on or dismissed',
  'title-too-long': `title exceeds ${MAX_TITLE} characters`,
  'detail-too-long': `detail exceeds ${MAX_DETAIL} characters — link to the rest in source.ref`,
  'bad-owner': 'owner is not a node id (person/…, agent/… or org/…)',
  'bad-source': 'source.repo is not repo/<slug>',
  'bad-ref': 'source.ref is not an https URL — a reference nobody can open is decoration',
  'unnormalised-capabilities': 'capabilitiesWanted is not trimmed, lowercased, de-duplicated and capped at 20',
  'bad-asserted': 'asserted is not a YYYY-MM-DD date',
  'no-asserter': 'every item names who filed it — an unattributed intention cannot be chased',
  'bad-visibility': 'visibility is not public, partner or private — it is never inferred, so a missing one is refused rather than defaulted',
  'derived-expiry': 'expires is not exactly asserted + the kind\'s window — it is derived, never a field a writer sets',
  'bad-expires': 'expires is not a date (reported only when the derived value cannot be computed)',
  'unpromoted-publication': 'a public or partner item with no promoted record — an item is private until a named human promotes it',
  'promoted-but-private': 'a promoted item is not private; promotion is recorded and one-way, and a retraction is a new revision with status dropped',
  'bad-promotion-date': 'promoted.at is not a YYYY-MM-DD date',
  'non-human-promotion': 'promoted.by is not a person/ id — an agent that could publish its own draft makes consent decorative',
  'promoted-before-filed': 'promoted.at is earlier than asserted',
  'foreign-item': 'the item\'s id names a repository other than the fragment\'s source — a document asserts intentions for its own repository only',
  'source-mismatch': 'source.repo does not match the repository named in the id',
  'foreign-owner': 'an org/ owner other than the fragment\'s own org — cross-org intent is a proposal the other side approves, never a row a stranger wrote',
  'duplicate-revision': 'the same (id, rev) appears twice in one fragment',
  'served-nonpublic': 'a partner or private item at a public URL — the served projection carries the public tier only',
}

export const WARNINGS = {
  'legacy-version-key': 'this fragment declares "backlog"; emitters should write "intent". Both are read, and always will be.',
}

// ── Checking ────────────────────────────────────────────────────────────────

/** Every problem in a fragment, as `[code, subject]` pairs. Empty means valid. */
export function checkFragment(fragment) {
  const out = []
  const add = (code, subject) => out.push([code, subject])

  if (!fragment || typeof fragment !== 'object' || Array.isArray(fragment)) { add('no-items'); return out }

  // Both version keys, forever. A fragment written before the rename is still valid.
  if ((fragment.intent ?? fragment[LEGACY_VERSION_KEY]) !== INTENT_VERSION) add('bad-version')
  for (const key of Object.keys(fragment)) {
    if (!FRAGMENT_KEYS.includes(key) && !isExtensionKey(key)) add('unknown-key', key)
  }
  if (!REPO_RE.test(fragment.source ?? '')) add('bad-fragment-source')
  if (!ORG_RE.test(fragment.org ?? '')) add('bad-fragment-org')
  if (!fragment.generated || typeof fragment.generated !== 'string' || Number.isNaN(Date.parse(fragment.generated))) add('bad-generated')
  if (!Array.isArray(fragment.items)) { add('no-items'); return out }

  const seen = new Map()
  for (const item of fragment.items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) { add('not-an-item'); continue }
    const at = typeof item.id === 'string' ? item.id : '(no id)'

    for (const key of Object.keys(item)) {
      if (!ITEM_KEYS.includes(key) && !isExtensionKey(key)) add('unknown-item-key', `${at}: ${key}`)
    }

    if (!ITEM_ID_RE.test(item.id ?? '')) add('bad-id', at)
    if (!Number.isInteger(item.rev) || item.rev < 1) add('bad-rev', at)
    if (!ITEM_KINDS.includes(item.kind)) add('bad-kind', at)
    if (!ITEM_STATUSES.includes(item.status)) add('bad-status', at)
    if (typeof item.title !== 'string' || !item.title.trim()) add('no-title', at)
    else if (item.title.length > MAX_TITLE) add('title-too-long', at)
    if (item.detail && String(item.detail).length > MAX_DETAIL) add('detail-too-long', at)
    if (item.owner !== undefined && !NODE_ID_RE.test(item.owner)) add('bad-owner', at)
    if (!REPO_RE.test(item.source?.repo ?? '')) add('bad-source', at)
    if (item.source?.ref !== undefined && !/^https:\/\//.test(item.source.ref)) add('bad-ref', at)

    if (item.capabilitiesWanted !== undefined) {
      const normalised = Array.isArray(item.capabilitiesWanted) ? normaliseCapabilities(item.capabilitiesWanted) : undefined
      if (JSON.stringify(normalised ?? []) !== JSON.stringify(item.capabilitiesWanted)) add('unnormalised-capabilities', at)
    }

    if (!DATE_RE.test(item.asserted ?? '')) add('bad-asserted', at)
    if (!item.assertedBy || !NODE_ID_RE.test(item.assertedBy)) add('no-asserter', at)
    if (!VISIBILITIES.includes(item.visibility)) add('bad-visibility', at)

    // Expiry is derived. A writer that can nudge its own keeps a dead idea
    // current forever.
    if (DATE_RE.test(item.asserted ?? '') && ITEM_KINDS.includes(item.kind)) {
      if (item.expires !== expiryFor(item.kind, item.asserted)) add('derived-expiry', at)
    } else if (!DATE_RE.test(item.expires ?? '')) add('bad-expires', at)

    // Filed is not published.
    const published = item.visibility === 'public' || item.visibility === 'partner'
    if (published && !item.promoted) add('unpromoted-publication', at)
    if (item.promoted) {
      if (!published) add('promoted-but-private', at)
      if (!DATE_RE.test(item.promoted.at ?? '')) add('bad-promotion-date', at)
      if (!String(item.promoted.by ?? '').startsWith('person/')) add('non-human-promotion', at)
      if (DATE_RE.test(item.promoted.at ?? '') && DATE_RE.test(item.asserted ?? '') && item.promoted.at < item.asserted)
        add('promoted-before-filed', at)
    }

    const owning = repoOfItem(item.id)
    if (owning && owning !== fragment.source) add('foreign-item', at)
    if (item.source?.repo && owning && item.source.repo !== owning) add('source-mismatch', at)
    if (String(item.owner ?? '').startsWith('org/') && item.owner !== fragment.org) add('foreign-owner', at)

    if (typeof item.id === 'string') {
      if (seen.get(item.id) === item.rev) add('duplicate-revision', at)
      seen.set(item.id, Math.max(seen.get(item.id) ?? 0, item.rev ?? 0))
    }
  }
  return out
}

/**
 * The projection rule, checkable where a stranger can run it: a document
 * served at a public URL may carry the public tier only. Returns the extra
 * `[code, subject]` pairs; empty when the projection is clean.
 */
export function checkProjection(fragment) {
  const out = []
  for (const item of Array.isArray(fragment?.items) ? fragment.items : []) {
    if (item && typeof item === 'object' && item.visibility !== 'public') out.push(['served-nonpublic', item.id ?? '(no id)'])
  }
  return out
}

/**
 * validate(doc) → { valid, errors, warnings }.
 *
 * `errors` and `warnings` are `{ code, subject, message }`. `valid` is true
 * exactly when there are no errors; a warning never fails a document. Pass
 * `{ served: true }` to also apply the projection rule for a document fetched
 * from a public URL.
 */
export function validate(doc, { served = false } = {}) {
  const pairs = checkFragment(doc)
  if (served) pairs.push(...checkProjection(doc))
  const errors = pairs.map(([code, subject]) => ({ code, subject, message: REFUSALS[code] }))
  const warnings = []
  if (doc && typeof doc === 'object' && !Array.isArray(doc) && doc.intent === undefined && doc[LEGACY_VERSION_KEY] === INTENT_VERSION) {
    warnings.push({ code: 'legacy-version-key', message: WARNINGS['legacy-version-key'] })
  }
  return { valid: errors.length === 0, errors, warnings }
}

/** The public tier, and only it — what a publisher serves without authentication. */
export const publicView = (items) => (Array.isArray(items) ? items.filter((i) => i?.visibility === 'public') : [])

// ── Reference constructors ──────────────────────────────────────────────────
//
// Pure, and here because two of the format's rules are enforced by the SHAPE
// of these functions rather than by a check: `fileItem` has no visibility
// argument and no expires argument, so nothing it produces can be anything
// but private with a derived expiry; `promoteItem` throws on anything but a
// person/ id. An implementation that offers a way round either is not an
// implementation of intent/1.

/** Always private, always rev 1, expiry always derived. There is no visibility argument. */
export function fileItem({ source, slug, kind, title, detail, owner, wants, ref, asserted = today(), by }) {
  if (!REPO_RE.test(source ?? '')) throw new TypeError(`source "${source}" is not repo/<slug>`)
  if (!ITEM_KINDS.includes(kind)) throw new TypeError(`kind must be one of ${ITEM_KINDS.join(', ')}`)
  if (!by || !NODE_ID_RE.test(by)) throw new TypeError(`by "${by}" is not a node id — every item names who filed it`)
  const repo = source.replace(/^repo\//, '')
  const item = {
    id: `intent/${repo}/${slug}`,
    rev: 1,
    kind,
    status: 'open',
    title: String(title ?? '').trim(),
    source: ref ? { repo: source, ref } : { repo: source },
    assertedBy: by,
    asserted,
    expires: expiryFor(kind, asserted),
    visibility: 'private',
  }
  if (detail) item.detail = String(detail).trim()
  if (owner) item.owner = owner
  const caps = normaliseCapabilities(wants)
  if (caps) item.capabilitiesWanted = caps
  return item
}

/** A new revision at a wider tier, recorded against the human who chose it. Agents suggest; humans consent. */
export function promoteItem(item, { by, to = 'partner', note, at = today() }) {
  if (!String(by ?? '').startsWith('person/')) throw new TypeError(`promote requires a person/ node id, got "${by}" — agents suggest, humans consent`)
  if (to !== 'public' && to !== 'partner') throw new TypeError(`promote widens to public or partner, got "${to}"`)
  const promoted = { at, by }
  if (note) promoted.note = String(note).trim()
  return { ...item, rev: item.rev + 1, visibility: to, promoted }
}

// ── Discovery ───────────────────────────────────────────────────────────────
//
// The spec's Discovery rules as code: https only, a timeout and a size cap,
// redirects kept to the same publisher, and above all `unreachable` never
// collapsed into `absent`. One deliberate narrowing, stated rather than
// hidden: the spec bounds redirects to the same registrable domain, which
// needs the public suffix list — a dependency this file does not have. So a
// redirect is accepted only when the hosts are identical or differ by a
// leading `www.`, which is stricter than the spec (fails closed) and never
// lets a.co.uk vouch for b.co.uk.

function sameishHost(a, b) {
  const strip = (h) => h.replace(/^www\./, '')
  return a === b || strip(a) === strip(b)
}

async function readCapped(res, maxBytes) {
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > maxBytes) return null
  if (!res.body) {
    const text = await res.text()
    return new TextEncoder().encode(text).length > maxBytes ? null : text
  }
  const reader = res.body.getReader()
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > maxBytes) { await reader.cancel(); return null }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let offset = 0
  for (const c of chunks) { all.set(c, offset); offset += c.length }
  return new TextDecoder().decode(all)
}

/**
 * Fetch a publisher's public projection and say what was found.
 *
 * `target` is a domain (`example.com`) or a full https URL. The four findings:
 * `published` (a valid public projection), `invalid` (something answered and
 * it fails validation — including a non-public item at a public URL),
 * `absent` (404/410: the publisher answered and publishes nothing), and
 * `unreachable`, which is NEVER collapsed into absent. `fetchImpl` is
 * injectable so the rules are testable with no network.
 */
export async function fetchFragment(target, options = {}) {
  const { timeoutMs = 10_000, maxBytes = 1_000_000, maxRedirects = 5 } = options
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (/^http:\/\//i.test(target)) {
    throw new Error('a consumer fetches over https only — an http URL is refused, not upgraded, so a downgrade cannot be quiet')
  }
  let url = /^https:\/\//i.test(target) ? target : `https://${target}${WELL_KNOWN_PATH}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    for (let hop = 0; ; hop++) {
      let res
      try {
        res = await fetchImpl(url, { redirect: 'manual', signal: controller.signal })
      } catch (error) {
        const detail = error instanceof Error ? (error.name === 'AbortError' ? 'timeout' : error.message) : String(error)
        return { finding: 'unreachable', url, detail }
      }

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        if (!location) return { finding: 'invalid', url, detail: `redirect with no location (${res.status})` }
        const next = new URL(location, url)
        if (next.protocol !== 'https:') return { finding: 'invalid', url, detail: 'redirected off https — refused' }
        if (!sameishHost(new URL(url).hostname, next.hostname)) {
          return { finding: 'invalid', url, detail: `redirected to ${next.hostname} — a redirect to another host would let any domain borrow another's record` }
        }
        if (hop >= maxRedirects) return { finding: 'unreachable', url, detail: 'too many redirects' }
        url = next.toString()
        continue
      }

      if (res.status === 404 || res.status === 410) return { finding: 'absent', url, detail: `http ${res.status}` }
      if (res.status !== 200) {
        // Not proof of absence and not a network failure of ours: the
        // conservative reading claims nothing about what the publisher publishes.
        return { finding: 'unreachable', url, detail: `http ${res.status}` }
      }

      const text = await readCapped(res, maxBytes)
      if (text === null) return { finding: 'invalid', url, detail: `response exceeds the ${maxBytes}-byte cap` }
      let parsed
      try { parsed = JSON.parse(text) } catch { return { finding: 'invalid', url, detail: 'not valid JSON' } }
      const result = validate(parsed, { served: true })
      if (!result.valid) return { finding: 'invalid', url, problems: result.errors, warnings: result.warnings }
      return { finding: 'published', url, fragment: parsed, ...(result.warnings.length ? { warnings: result.warnings } : {}) }
    }
  } finally {
    clearTimeout(timer)
  }
}

// ── Conformance vectors ─────────────────────────────────────────────────────

/** A vector file wraps a document in `{ name, why, verdict, document, errors?, warnings? }`. */
export const isVector = (parsed) =>
  !!parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
  typeof parsed.verdict === 'string' && 'document' in parsed && !('items' in parsed)

const codesOf = (list) => [...new Set(list.map((p) => p.code))].sort()

/**
 * Run one vector: does this checker agree with it? Returns
 * `{ name, agreed, expected, actual, expectedWarnings, actualWarnings }`.
 * A vector asserts the EXACT set of error codes, not "at least these".
 */
export function runVector(vector) {
  const result = validate(vector.document)
  const actual = codesOf(result.errors)
  const expected = vector.verdict === 'valid' ? [] : [...(vector.errors ?? [])].sort()
  const actualWarnings = codesOf(result.warnings)
  const expectedWarnings = vector.warnings ? [...vector.warnings].sort() : undefined
  const agreed =
    JSON.stringify(actual) === JSON.stringify(expected) &&
    (expectedWarnings === undefined || JSON.stringify(actualWarnings) === JSON.stringify(expectedWarnings))
  return { name: vector.name, agreed, expected, actual, expectedWarnings, actualWarnings }
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function run(argv) {
  const command = argv[0]
  const has = (name) => argv.includes(`--${name}`)

  if (command === 'check') {
    const path = argv[1]
    if (!path) { console.error('usage: node vendor-intent.mjs check <file.json> [--served]'); return 2 }
    let parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (isVector(parsed)) {
      console.log(`(conformance vector "${parsed.name}" — checking its document)`)
      parsed = parsed.document
    }
    const result = validate(parsed, { served: has('served') })
    for (const w of result.warnings) console.log(`⚠ [${w.code}] ${w.message}`)
    for (const e of result.errors) console.error(`✗ ${e.subject ?? ''} [${e.code}] ${e.message}`)
    console.log(result.valid ? 'ok' : `${result.errors.length} problem(s)`)
    return result.valid ? 0 : 1
  }

  if (command === 'vectors') {
    const dir = argv[1] ?? 'vectors'
    const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    let disagreed = 0
    for (const file of files) {
      const vector = JSON.parse(readFileSync(join(dir, file), 'utf8'))
      const r = runVector(vector)
      if (r.agreed) console.log(`✓ ${vector.name} (${vector.verdict}${r.expected.length ? `: ${r.expected.join(', ')}` : ''})`)
      else { disagreed++; console.error(`✗ ${vector.name}: expected [${r.expected.join(', ')}] got [${r.actual.join(', ')}]`) }
    }
    console.log(`${files.length} vector(s), ${disagreed} disagreement(s)`)
    return disagreed ? 1 : 0
  }

  if (command === 'verify') {
    const target = argv[1]
    if (!target) { console.error('usage: node vendor-intent.mjs verify <domain|https-url>'); return Promise.resolve(2) }
    return fetchFragment(target).then((r) => {
      console.log(`${r.finding} ${r.url}${r.detail ? ` — ${r.detail}` : ''}`)
      for (const p of r.problems ?? []) console.error(`✗ ${p.subject ?? ''} [${p.code}] ${p.message}`)
      if (r.finding === 'published') console.log(`${r.fragment.items.length} public item(s)`)
      return r.finding === 'published' ? 0 : 1
    })
  }

  console.log(readFileSync(new URL(import.meta.url)).toString().split('\n').filter((l) => l.startsWith('//   node')).join('\n'))
  return 2
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  Promise.resolve(run(process.argv.slice(2)))
    .then((code) => process.exit(code))
    .catch((error) => { console.error(error.message); process.exit(1) })
}
