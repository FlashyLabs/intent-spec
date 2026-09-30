# `intent/1`

Status: draft

Contract: `intent/1`

A published statement of what an organisation intends to do, emitted per
repository and merged across an estate. This document is normative. The
reference implementation is [FlashyLabs/intentmesh](https://github.com/FlashyLabs/intentmesh);
where it and this text disagree, one of them is wrong and an issue here says
which. The checker beside this file, `vendor-intent.mjs`, enforces every rule
below and no others, and `test/intent.test.mjs` asserts that the refusal table
in this document and the codes the checker can emit are the same set.

**Version 1 is frozen.** The document shape under `intent/1` — its keys, its
kinds, its decay windows and its refusals — does not change. A change to what a
valid `intent/1` document *is* mints `intent/2`; it never edits version 1. What
still moves is prose clarity and the checker's fidelity to these rules, never
the rules themselves.

## The document

One repository emits one document. `source` is the repository that emitted
it; `org` is the organisation that repository speaks for. Both are node ids,
and the pair is the authority claim: this document asserts intentions for that
repository and no other.

```json
{
  "intent": "1",
  "source": "repo/example",
  "org": "org/example",
  "generated": "2026-09-01T00:00:00Z",
  "items": [
    {
      "id": "intent/example/settlement-rails",
      "rev": 1,
      "kind": "task",
      "status": "open",
      "title": "Settlement rails for cross-border payouts",
      "detail": "Optional, up to 2000 characters.",
      "owner": "person/avery",
      "source": { "repo": "repo/example", "ref": "https://github.com/example/example/issues/12" },
      "capabilitiesWanted": ["payments", "compliance"],
      "promoted": { "at": "2026-09-01", "by": "person/avery", "note": "Optional." },
      "asserted": "2026-09-01",
      "assertedBy": "agent/example-bot",
      "expires": "2026-11-30",
      "visibility": "public"
    }
  ]
}
```

`schema/intent-1.json` (JSON Schema draft 2020-12) describes the shape. A
document that satisfies it is *well-formed*. Several rules below are
cross-field and cannot be expressed in JSON Schema — derived expiry,
promotion before publication, the authority rules — so a schema-valid
document is not necessarily a *permitted* one. `vendor-intent.mjs` is the
difference.

## Field rules

### The envelope

| Field | Required | Rule |
|---|---|---|
| `intent` | one of the two | The literal string `"1"`. |
| `backlog` | one of the two | Legacy alias for `intent`, from before the rename. Same value, same meaning; a reader accepts it forever and an emitter should write `intent`. |
| `source` | yes | `repo/<slug>`, where `<slug>` is `[a-z0-9][a-z0-9._-]*`. The emitting repository. |
| `org` | yes | `org/<slug>`. The organisation the repository speaks for. |
| `generated` | yes | An RFC 3339 timestamp. |
| `items` | yes | An array, possibly empty. Empty is the honest first state. |
| `x-*` | no | Extension keys, any value. Carried without complaint; a reader ignores what it does not understand. |

Any other key is refused.

### An item

| Field | Required | Rule |
|---|---|---|
| `id` | yes | `intent/<repo-slug>/<item-slug>`, or `backlog/…` from before the rename. Stable for the life of the intention and never reissued: an id is what somebody else may have quoted. The repo slug must be the envelope's `source`. |
| `rev` | yes | Integer from 1. A change is a new record with a higher `rev`, never an edit. |
| `kind` | yes | `idea` · `task` · `bug` · `blocker` · `decision`. Each buys a decay window. |
| `status` | yes | `open` · `doing` · `blocked` · `done` · `dropped`. `blocked` is a state; a `blocker` is a thing somebody must unblock. |
| `title` | yes | Non-blank, ≤ 140 characters. |
| `detail` | no | ≤ 2000 characters. Beyond that, link to it in `source.ref`. |
| `owner` | no | A node id — `person/…`, `agent/…` or `org/…`. An `org/` owner must be the envelope's own `org`. |
| `source` | yes | `{ repo, ref? }`. `repo` must match the repository the `id` names; `ref` is an https URL when present. |
| `capabilitiesWanted` | no | Already normalised: trimmed, lowercased, de-duplicated, ≤ 20 entries. |
| `promoted` | no | `{ at, by, note? }`. `by` **must** be a `person/` id; `at` is `YYYY-MM-DD`, on or after `asserted`. Present exactly when `visibility` is `public` or `partner`. |
| `asserted` | yes | `YYYY-MM-DD`. When this intention was (last) stated. |
| `assertedBy` | yes | A node id. Usually an agent — that is the intended case. |
| `expires` | yes | **Derived**: `asserted` + the kind's window, and exactly that. Never a field a writer chooses. |
| `visibility` | yes | `public` · `partner` · `private`. Stated, never inferred. |
| `x-*` | no | Extension keys, any value. |

Any other key is refused.

### Decay windows

| Kind | Days | Because |
|---|---|---|
| `blocker` | 14 | A fortnight-old blocker is either resolved or unimportant. |
| `bug` | 30 | A bug nobody fixed in a month is a decision, not a bug. |
| `decision` | 30 | A decision not taken in a month has been taken by default. |
| `task` | 90 | A quarter is the longest a task can sit and still be a task. |
| `idea` | 180 | An idea nobody picked up in six months is not a plan. |

`expires` is `asserted` plus the window, computed in UTC on calendar days. An
expired item is not false; it has stopped claiming to be current, which is the
difference between a backlog and a graveyard. Re-asserting an item (a new
`rev` with a new `asserted`) resets its window, and that is the intended way
to keep something alive: somebody looked at it and said it again.

## The three rules the format exists for

**Expiry is derived, never accepted as input.** A writer who can set `expires`
can keep a dead idea current forever without re-checking whether it is still
true, which is the one way to defeat decay. The checker refuses an `expires`
that is not *exactly* the derived value — not "no longer than", exactly — because
a writer who can shorten it can also lengthen it by asserting a date that never
happened.

**Filed is not published.** An item is `private` until a *named human*
promotes it. The reference constructor `fileItem` has no visibility argument
and no expires argument, so nothing it produces can be anything but private
with a derived expiry; `promoteItem` throws on anything but a `person/` id.
On the wire, a `public` or `partner` item with no `promoted` record is
refused, and so is a promotion attributed to an agent. Agents suggest; humans
consent.

**A document speaks for its own repository and organisation.** Every item's
`id` names the envelope's `source`; an `org/` owner is the envelope's `org`.
Without this, one organisation's file could carry another's plan, and a merge
would accept it.

## Refusals

What `vendor-intent.mjs` refuses, by code. A refusal is an error: the document
is not a permitted `intent/1` fragment. The checker refuses rather than
guesses — nothing below is corrected, defaulted or mapped to the nearest valid
value.

| Code | Why |
|---|---|
| `bad-version` | Neither `intent` nor `backlog` is `"1"`. An unknown version is refused, never guessed at. |
| `unknown-key` | A top-level key version 1 does not define. Extensions are `x-` prefixed; anything else is refused rather than carried silently, because a key nobody validates is a field a reader will start acting on. |
| `bad-fragment-source` | `source` is not `repo/<slug>`. |
| `bad-fragment-org` | `org` is not `org/<slug>`. |
| `bad-generated` | `generated` is not a timestamp. |
| `no-items` | The document is not an object, or carries no `items` array. A fragment without items is not a fragment. |
| `not-an-item` | An entry in `items` is not an object. |
| `unknown-item-key` | An item key version 1 does not define, not `x-` prefixed. Same reason as `unknown-key`. |
| `bad-id` | `id` is not `intent/<repo>/<slug>` (or `backlog/<repo>/<slug>`). |
| `bad-rev` | `rev` is not an integer from 1. |
| `bad-kind` | `kind` is not one of the five. An unknown kind has no decay window, so nothing can be derived from it. |
| `bad-status` | `status` is not one of the five. |
| `no-title` | Blank or missing title. An item with no title cannot be acted on or dismissed. |
| `title-too-long` | Title exceeds 140 characters. |
| `detail-too-long` | Detail exceeds 2000 characters. Link to the rest in `source.ref`. |
| `bad-owner` | `owner` is not a node id. |
| `bad-source` | `source.repo` is not `repo/<slug>`. |
| `bad-ref` | `source.ref` is not an https URL. A reference nobody can open is decoration. |
| `unnormalised-capabilities` | `capabilitiesWanted` is not trimmed, lowercased, de-duplicated and capped at 20. A matcher that normalises on read is a second vocabulary. |
| `bad-asserted` | `asserted` is not `YYYY-MM-DD`. |
| `no-asserter` | `assertedBy` is missing or not a node id. An unattributed intention cannot be chased. |
| `bad-visibility` | `visibility` is not `public`, `partner` or `private`. A missing visibility is refused, never defaulted: assuming private would be right most of the time, assuming public would be a disclosure, and refusing is the only reading that cannot be wrong. |
| `derived-expiry` | `expires` is not exactly `asserted` + the kind's window. |
| `bad-expires` | `expires` is not a date. Reported only when the derived value cannot be computed (a bad `kind` or `asserted`), so the two refusals never stack. |
| `unpromoted-publication` | `public` or `partner` with no `promoted` record. An item is private until a named human promotes it. |
| `promoted-but-private` | A `private` item carrying a `promoted` record. Promotion is one-way and recorded; a retraction is a new revision with `status: dropped`. |
| `bad-promotion-date` | `promoted.at` is not `YYYY-MM-DD`. |
| `non-human-promotion` | `promoted.by` is not a `person/` id. An agent that could publish its own draft makes consent decorative. |
| `promoted-before-filed` | `promoted.at` is earlier than `asserted`. |
| `foreign-item` | The `id` names a repository other than the envelope's `source`. |
| `source-mismatch` | `source.repo` disagrees with the repository the `id` names. |
| `foreign-owner` | An `org/` owner other than the envelope's `org`. Cross-org intent is a proposal the other side approves, never a row a stranger wrote. |
| `duplicate-revision` | The same `(id, rev)` appears twice in one fragment. |
| `served-nonpublic` | A `partner` or `private` item in a document checked as *served* (`check --served`, or fetched by `verify`). The public projection carries the public tier only. Not a refusal of the record itself — a full record legitimately holds every tier. |

One warning, which never fails a document:

| Code | Why |
|---|---|
| `legacy-version-key` | The document declares `backlog` rather than `intent`. Read forever; emitters should write `intent`. |

## Discovery / Serving

### The public projection

A publisher serves **the public projection** — the envelope with only its
`public` items — at:

```
https://<domain>/.well-known/intent.json
```

It never serves its own full record there. The tiers below public are not
served without authentication, and `partner` is not an exception: a
partner-tier record behind no gate is a public record with a misleading
label. An emitter writes the projection itself rather than copying a file,
because a copy step can be forgotten and forgetting it publishes private
items at a URL. `vendor-intent.mjs check <file> --served` applies this rule
to a file; `publicView(items)` is the filter.

The estate convention is also to commit the full record as
`intent.fragment.json` at the repository root, for a merge that reads
checkouts. Where a document is served is the emitter's choice; that it is the
projection is not.

### Fetching one

A consumer fetching a publisher's projection:

- **must** fetch over `https` only. An `http` URL is refused, not upgraded,
  so a downgrade cannot be quiet.
- **must** apply a timeout and a response size cap. The checker's defaults
  are 10 seconds and 1,000,000 bytes.
- **must** follow redirects only within the same registrable domain — an apex
  that redirects to `www` is the same publisher; a redirect to another host is
  not, and following it would let any domain borrow another's record. A
  redirect off `https` is refused. The checker narrows this deliberately: it
  accepts a redirect only when the hosts are identical or differ by a leading
  `www.`, because deciding registrable domains properly needs the public
  suffix list, which is a dependency. That is stricter than the rule (it fails
  closed) and never lets `a.co.uk` vouch for `b.co.uk`.
- **must not** treat an unreachable publisher as one that published nothing.
  `absent` and `unreachable` are different findings, and collapsing them
  makes a claim about somebody else's organisation on the strength of your
  own network failure.

The four findings, as `vendor-intent.mjs verify <domain>` reports them:

| Finding | Meaning |
|---|---|
| `published` | A 200 with a valid public projection. |
| `absent` | A 404 or 410. The publisher answered and publishes nothing. |
| `unreachable` | A network error, a timeout, too many redirects, or any other status. A fact about the path between you and them, not about what they publish. |
| `invalid` | Something answered and it is not a permitted projection: not JSON, over the size cap, a redirect to another host or off https, a document the checker refuses, or — the worst case — a non-public item at the public URL. |

There is no index and no registry in the format. A merge is over the
fragments you already know about.

## The legacy `backlog` key

This format was published as `backlog/1` before it was named `intent/1`. A
conforming reader **must** accept a document whose version key is `backlog`
instead of `intent` and **must** treat it as identical in every other respect;
a conforming emitter **should** write `intent`. Item ids beginning `backlog/`
remain valid permanently. This is not a transitional measure with an end
date: a protocol that breaks its first users to tidy up its own branding
teaches everyone else to wait for version three.

## Merging

Highest `rev` per `id` wins. Two fragments carrying the same `(id, rev)` with
different bodies is a conflict to report, never resolve silently. An item
whose `id` names a repository other than the emitting one is dropped as
`foreign-item`, because a merge is reachable with documents nobody validated.
Filtering by tier happens on the query: a consumer receives only the tiers it
is entitled to and never holds a record it must remember to hide. An
unrecognised tier is treated as `public` — failing closed is the only safe
default for a rule whose failure mode is disclosure. The checker in this
repository validates single documents; merging is the implementation's.

## What version 1 does not carry

- **No authentication, authorisation or transport of its own.** It is a JSON
  file you serve. Publishing one at a domain proves someone can write to that
  host, and nothing more.
- **No discovery protocol.** No index, no registry, no crawl. Two
  organisations reading each other's files is the network.
- **No caller-chosen expiry, and no way to add one.** There will not be an
  `x-expires` that a reader honours.
- **No visibility below `private`, and no tier between `partner` and
  `public`.** Three tiers, filtered on the query.
- **No assignees, sprints, estimates, priorities or dependencies.** It is
  what you publish *about* your tracker, not the tracker. An extension may
  carry them under `x-` keys; nothing in version 1 reads them.
- **No sealing, signing or hashing of items.** An intention decays and is
  never sealed; the past tense is a different format with different rules
  (`shipped/1`), and making the two symmetric breaks one of them. The
  reference implementation notarises content-free hashes onto a transparency
  log; that surface is the implementation's, not this format's.
- **No cross-organisation items.** An intention aimed at another organisation
  is a proposal that organisation approves, in a different layer.
