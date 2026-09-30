// Machine-checked parity with the reference implementation.
//
// intent-spec is canonical; FlashyLabs/intentmesh is the reference
// implementation, and its checker is `vendor-intentmesh.mjs`. Until now the
// claim that the two agree was only prose. This suite runs BOTH checkers over
// this repository's conformance vectors and compares them verdict by verdict —
// valid vs the exact set of refusal codes.
//
// Both checkers export `checkFragment(fragment)`, which returns `[code, subject]`
// pairs, so no subprocess is needed: the sibling module is imported directly.
// It imports `node:` builtins only, like this repository, so the parity check
// stays dependency-free. When the sibling checkout is absent the suite reports
// UNKNOWN and skips — it never reports a pass it could not run.
//
// The two checkers do NOT agree on everything, and pretending otherwise would
// be the dishonest thing. intent-spec enforces "unknown keys are refused unless
// x- prefixed" (SPEC.md, `unknown-key` / `unknown-item-key`); the reference
// implementation's checker does not yet carry that rule, so it accepts a
// document intent-spec refuses. That gap is pinned below with its reason, and
// the test fails in BOTH directions: a NEW divergence outside the known set is
// a parity regression, and a known divergence that HEALS (the reference
// implementation catching up) is a signal to delete its row here.
//
// node: builtins only, no install.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkFragment as specCheck } from '../vendor-intent.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VECTORS = join(ROOT, 'vectors');
const SIBLING = join(ROOT, '..', 'intentmesh', 'vendor-intentmesh.mjs');

// The vectors on which intent-spec and the reference implementation's checker
// are known to disagree, each with the reason. intent-spec is canonical.
const KNOWN_DIVERGENCES = {
  'unknown-key':
    "intent/1 refuses a top-level key it does not define unless x- prefixed; intentmesh's vendor-intentmesh.mjs does not carry the unknown-key rule and accepts it.",
  'unknown-item-key':
    "intent/1 refuses an item key it does not define unless x- prefixed; intentmesh's vendor-intentmesh.mjs does not carry the unknown-item-key rule and accepts it.",
};

const codesOf = (pairs) => [...new Set(pairs.map((p) => p[0]))].sort();
const readVector = (f) => JSON.parse(readFileSync(join(VECTORS, f), 'utf8'));
const vectorFiles = () => readdirSync(VECTORS).filter((f) => f.endsWith('.json')).sort();
const expectedCodes = (v) => (v.verdict === 'valid' ? [] : [...(v.errors ?? [])].sort());

test('every KNOWN_DIVERGENCES entry names a real vector', () => {
  const names = new Set(vectorFiles().map((f) => f.replace(/\.json$/, '')));
  for (const name of Object.keys(KNOWN_DIVERGENCES)) {
    assert.ok(names.has(name), `KNOWN_DIVERGENCES names "${name}", which is not a vector`);
  }
});

test('intent-spec and the intentmesh checker agree on every vector, save the pinned gaps (or UNKNOWN)', async () => {
  if (!existsSync(SIBLING)) {
    console.log('UNKNOWN: sibling intentmesh checkout is absent; cannot verify parity with the reference implementation');
    return;
  }
  const mesh = await import(pathToFileURL(SIBLING).href);
  assert.equal(typeof mesh.checkFragment, 'function', 'the sibling checker does not export checkFragment');

  const files = vectorFiles();
  assert.ok(files.length > 0, 'no vectors found');

  const healed = [];
  for (const f of files) {
    const name = f.replace(/\.json$/, '');
    const v = readVector(f);
    const specCodes = codesOf(specCheck(v.document));
    const meshCodes = codesOf(mesh.checkFragment(v.document));
    const agree = JSON.stringify(specCodes) === JSON.stringify(meshCodes);

    if (name in KNOWN_DIVERGENCES) {
      // A pinned gap. If the two now agree, the reference implementation has
      // caught up and this row must be removed — that is a failure, on purpose.
      if (agree) healed.push(name);
      continue;
    }

    assert.deepEqual(
      meshCodes,
      specCodes,
      `parity regression on ${f}: intent-spec=[${specCodes}] intentmesh=[${meshCodes}] — ` +
        `if this is a real, intended divergence add it to KNOWN_DIVERGENCES with a reason`,
    );
    // Where they agree, they agree with the vector's own declared verdict too,
    // so parity is measured against the canonical answer, not just each other.
    assert.deepEqual(specCodes, expectedCodes(v), `${f}: the agreed verdict is not the vector's declared one`);
  }

  assert.deepEqual(
    healed,
    [],
    `these pinned divergences now agree — the reference implementation caught up; delete their KNOWN_DIVERGENCES rows: ${healed.join(', ')}`,
  );
});
