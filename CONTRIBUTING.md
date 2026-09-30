# Contributing

This repository holds the `intent/1` specification and nothing else. If what
you want is a feature — an emitter flag, a merge behaviour, a site — it belongs
in the reference implementation, [FlashyLabs/intentmesh](https://github.com/FlashyLabs/intentmesh).
If what you want changes what a permitted `intent/1` document *is*, it belongs
here, and it is a specification change.

## Running it

Node 22. Nothing to install.

```bash
npm run lint                                            # node --check over every .mjs
npm test                                                # node --test test/
node vendor-intent.mjs check vectors/minimal-valid.json  # ok
node vendor-intent.mjs vectors                          # every vector against the checker
```

## The order a specification change is made in

Spec first. Always this order, one pull request, no step skipped:

1. **`SPEC.md`** — state the rule, and add its row to the Refusals table if
   it refuses something. A rule the spec does not name is not a rule.
2. **`schema/intent-1.json`** — if the shape changes. The schema is
   structural only; cross-field rules are not expressed in it and should not
   be forced into it.
3. **`vendor-intent.mjs`** — implement the rule, add its code to `REFUSALS`
   with the reason. The suite fails if the table in `SPEC.md` and `REFUSALS`
   name different sets.
4. **`vectors/`** — add a vector that fails without the change, named for the
   refusal it triggers, with a `why` that says what goes wrong if an
   implementation accepts it. A vector asserts the *exact* set of codes.
5. **`test/intent.test.mjs`** — a unit test for the rule, if a vector alone
   cannot pin it (redirect handling, a constructor's missing argument).

Then open an issue or pull request in intentmesh so the reference
implementation follows, and say in this pull request that you have.

## What a change needs

- **A test that fails without it.** Not a test that exercises the code; one
  that would have caught the thing.
- **A reason in the commit message.** What was wrong, not what you did.
- **No dependencies.** `node:` builtins only. A pull request adding a
  `dependencies` key or an install step to CI will be declined however good
  the library is.

## What will be declined

- Anything that lets a writer set `expires`, including an `x-` key a reader
  would honour.
- Anything that gives `fileItem` a visibility argument, or lets a
  non-`person/` id promote.
- Anything that serves a tier below `public` without authentication.
- Anything that makes the checker guess: a default filled in for a missing
  field, an unknown key carried silently, an unknown version mapped to a
  known one.
- Widening `ITEM_KINDS`. Each kind buys a decay window; a kind added to make
  a classification easier inflates the number people read.
- A change to the licence. It is Apache-2.0 (holder Flashy Labs), declared once
  in the estate register in flashyos `tools/estate-licences.mjs`; that register
  is the authority, not a decision made in this repository.

## Commit messages

End with the attribution lines your tooling requires, if any. State the branch
you tested on if it is not the default.
