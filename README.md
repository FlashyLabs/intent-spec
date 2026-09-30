# intent/1

<img src="brand/assets/bolt-gold.svg" width="48" alt="">

`intent/1` is a small JSON format for publishing what an organisation intends
to do next — one document per repository, served at the publisher's own domain,
merged across an estate — and this repository is its canonical, vendor-neutral
home for anyone implementing, publishing or reading it. The specification, the
JSON Schema, the conformance vectors and a dependency-free checker live here
and nothing else does; the reference implementation lives in
[FlashyLabs/intentmesh](https://github.com/FlashyLabs/intentmesh).

## Quick start

Node 22, no install.

```bash
node vendor-intent.mjs check vectors/minimal-valid.json   # ok
node vendor-intent.mjs check vectors/derived-expiry.json  # names the refusal, exits 1
node vendor-intent.mjs vectors                            # runs the whole corpus against the checker
```

`node vendor-intent.mjs verify <domain>` fetches a live publisher's
`/.well-known/intent.json` the way a stranger would and reports one of
`published`, `absent`, `unreachable` or `invalid`. It needs a network; the
tests do not.

## What makes it different

**Expiry is derived, never accepted as input.** Every item carries `expires`,
and the checker refuses any value that is not exactly `asserted` plus the
kind's window (a blocker lives 14 days, a bug or a decision 30, a task 90, an
idea 180). A writer who could set their own expiry could keep a dead idea
current forever; a writer who can shorten one can lengthen one. Re-asserting
an item is how it stays alive — somebody looked and said it again.

**Filed is not published.** An item is `private` until a named human promotes
it. The reference constructor `fileItem` has no visibility argument; a `public`
or `partner` item with no `promoted` record is refused; a promotion whose `by`
is not a `person/` id is refused. Agents suggest; humans consent, and the
consent is a wire fact rather than a policy.

**The served copy is a projection, never the record.** A publisher serves only
its `public` items at `/.well-known/intent.json`. `partner` is not an
exception — a partner-tier item behind no gate is a public item with a
misleading label. `check --served` and `verify` refuse a non-public item at a
public URL as `served-nonpublic`.

**Unknown keys are refused unless `x-` prefixed.** At the top level and inside
an item. A key nobody validates is a field a reader will start acting on;
an extension declares itself.

**Unreachable is not absent.** A consumer fetches over https only, with a
timeout and a size cap, follows redirects only within the same publisher, and
never reads a network failure as "they publish nothing" — that would be a claim
about somebody else's organisation on the strength of your own outage.

**A document speaks for its own repository.** Every item's id names the
envelope's `source`; an `org/` owner is the envelope's own `org`. One id, one
authority.

**The legacy `backlog` key is read forever.** The format was `backlog/1`
before it was `intent/1`; a reader accepts both keys permanently and warns on
the old one. Ids beginning `backlog/` are never rewritten.

Every one of these is a test in `test/intent.test.mjs`, and every refusal the
checker can emit is a row in `SPEC.md`'s Refusals table — the suite fails if
the two sets differ.

## Layout

| Path | What lives there |
|---|---|
| `SPEC.md` | The normative specification: document shape, field rules, refusals, discovery. |
| `schema/intent-1.json` | JSON Schema (draft 2020-12) for the shape. Schema-valid is well-formed, not necessarily permitted. |
| `vendor-intent.mjs` | The dependency-free checker: `validate(doc)`, the reference constructors, the fetch rules, and the CLI. `node:` builtins only. |
| `vectors/` | Conformance vectors: a document, a verdict, and the exact refusal codes. 22 today — 5 valid, 17 invalid, each invalid named for the refusal it triggers. |
| `test/intent.test.mjs` | `node --test`: every vector, a unit test per rule, and the prose-agrees-with-code checks. |
| `test/parity.test.mjs` | Runs this checker and intentmesh's over every vector and compares them verdict by verdict; UNKNOWN when the sibling checkout is absent. |
| `tools/lint.mjs` | `node --check` over every `.mjs` in the tree. |
| `CLAUDE.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` | How this repository is worked on. |

## Links

- **Reference implementation:** [FlashyLabs/intentmesh](https://github.com/FlashyLabs/intentmesh) — the TypeScript library, the CLI, the emitter, the merge, the GitHub Action. This repository's checker is a port of its validation rules; the vectors here started as its vectors.
- **Sibling estate standards:** `ritual/1` (a subject's rite calendar — liturgies and the observances performed against them; Rites-Network), `aao/0.1` (the Autonomous Agent Organisation charter; `@flashyos/aao`), `trust/1` (the trust edge with its measured/asserted/estimated registers; Magician). Each is a separate format with its own repository; `intent/1` is the future tense beside them and imports none of their vocabulary.
- Companion formats the reference implementation interoperates with: `shipped/1`, `checkpoint/1`, `devlog/1` — the past tense, sealed where an intention decays.

## Where it sits in the stack

`intent/1` is the discovery layer of Web 4 — the agentic internet as a stack of
open protocols. The human map of the whole stack is
[web4](https://github.com/FlashyLabs/web4); its machine twin is
[stack.json](https://github.com/FlashyLabs/stack.json), served at
`/.well-known/stack.json`. This repository serves its own institutional front
door — the same config-driven, dependency-free door every protocol repository in
the estate serves — generated into `site/` by `node scripts/build-site.mjs` from
`site.config.json` and its vendored inputs. It is committed here and, once
deployed, is served at `https://flashylabs.github.io/intent-spec/` (committed as
of 2026-09-29, not yet fetched).

Status: draft. Version 1 is implemented and in use in one estate; it has no
independent adopter yet, and it is not published as a standard until it does.

Version 1 is frozen: the document shape under `intent/1` does not change — a
change to what a valid document is mints `intent/2`, never edits version 1.

Licensed under Apache-2.0 (holder Flashy Labs); the estate register in flashyos `tools/estate-licences.mjs` is the authority.
