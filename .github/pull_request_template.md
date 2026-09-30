## What was wrong

<!-- The reason, not the diff. -->

## Spec-first order

For a change to what a permitted document is, tick in order; every step is in this pull request:

- [ ] `SPEC.md` states the rule (and its Refusals row, if it refuses)
- [ ] `schema/intent-1.json` follows, if the shape changed
- [ ] `vendor-intent.mjs` enforces it, and `REFUSALS` carries the code and reason
- [ ] a vector in `vectors/` fails without the change and is named for its refusal
- [ ] `test/intent.test.mjs` pins what a vector cannot
- [ ] an issue or pull request is open in FlashyLabs/intentmesh so the reference implementation follows (link: )

For anything else (clarity, tooling, docs), say so and skip the list.

## Checks

- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] no dependency or install step was added; the licence is unchanged (Apache-2.0, holder Flashy Labs, per the estate register)
- [ ] no figure or adoption claim was added that a test does not assert

## Branch measured

<!-- `git symbolic-ref --short refs/remotes/origin/HEAD` and the branch you ran the suite on. -->
