# intent-spec — the canonical home of `intent/1`

## What makes this repository different

**It is the specification, and only the specification.** `SPEC.md`,
`schema/intent-1.json`, `vectors/`, and `vendor-intent.mjs` — a dependency-free
checker that enforces exactly the rules the spec states. There is no emitter,
no merge, no CLI beyond `check`, `vectors` and `verify`, no site, no state.
The implementation is [FlashyLabs/intentmesh](https://github.com/FlashyLabs/intentmesh),
and a feature belongs there unless it changes what a valid document *is*.

**Spec-first, in this order.** A change to what a permitted `intent/1`
document looks like is made in `SPEC.md` first, then `schema/intent-1.json`,
then `vendor-intent.mjs`, then a vector that would fail without it. Never the
other way round: a checker that refuses something the spec does not name is a
different standard, and the suite fails on it — `test/intent.test.mjs` compares
the Refusals table in `SPEC.md` against the codes the checker can emit and
requires the two sets to be identical.

**The checker is a port, not an invention.** `vendor-intent.mjs` carries the
validation rules of intentmesh's `vendor-intentmesh.mjs` and `src/validate.ts`,
and the discovery rules of its `src/fetch.ts`. The vectors were copied from
there and extended one-per-refusal. Where the two repositories disagree about
a document, say which is wrong rather than changing this one to agree.

**Dependency-free is a rule, not a preference.** `node:` builtins only, Node
22, ESM. There is no `dependencies` key and no install step in CI. A check
that needs an install is a check that can quietly not run.

## Commands

```bash
npm run lint    # node --check over every .mjs (tools/lint.mjs walks the tree)
npm test        # node --test test/
node vendor-intent.mjs check <file.json> [--served]
node vendor-intent.mjs vectors
node vendor-intent.mjs verify <domain>    # needs a network; nothing else here does
```

## Rules — each enforced by a test

- **`expires` is exactly the derived value.** `asserted` + the kind's window
  (blocker 14, bug 30, decision 30, task 90, idea 180). One day longer or
  shorter is `derived-expiry`. `fileItem` has no expires argument.
- **Private by default; publication needs a named human.** `fileItem` has no
  visibility argument. `public`/`partner` without `promoted` is refused;
  `promoted.by` must be `person/`; a missing `visibility` is refused, never
  defaulted.
- **Only the public projection is served.** `publicView` keeps `public` only;
  `check --served` and `verify` refuse anything else as `served-nonpublic`.
- **Unknown keys are refused unless `x-` prefixed**, at the top level and
  inside an item. The checker's key lists are the schema's `properties`.
- **The discovery rules:** https only (refused, not upgraded); timeout and
  size cap; redirects only within the same publisher (identical host or a
  leading `www.` — stricter than the spec's registrable domain, by design);
  `absent` (404/410) is never `unreachable` and `unreachable` is never
  `absent`.
- **The legacy `backlog` key is valid forever** and warns.
- **Every vector agrees with the checker exactly** — the full set of codes,
  not "at least these" — and every invalid vector is named for its refusal.
- **`SPEC.md` lists every refusal and no other.** The suite reads the table.
- **No licence is declared here.** No `LICENSE` file, no `license` field.
  The README's last line says so in the exact words the estate requires.

## House rules — true in every repository in this estate

**`main` is not necessarily the default branch.** Ask, every time: `git symbolic-ref --short refs/remotes/origin/HEAD`.

**Say which branch you measured.** Reading the working tree tells you about your checkout, not the repository.

**Re-vendor before you trust a vendored change.** Files named `vendor-*.mjs` are byte-identical copies; a stale copy disagrees silently.

**No secret in a file, a repo, or an artifact.** Secret Manager only.

**The licence is declared once**, in `tools/estate-licences.mjs` in flashyos. Do not decide this repository's licence inside it.

**A generated file is regenerated, never hand-edited.**

**Report what happened, including when it is worse than expected.**
