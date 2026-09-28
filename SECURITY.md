# Security

## Reporting

Email **security@flashylabs** — this is the estate's private channel and the
address is to be confirmed before launch; if it does not resolve, open an
issue that says only "security report, please contact me" and a maintainer
will reach out privately. Do not put the finding in the issue.

Include what you found, how to reproduce it, and what you think the impact is.
No formal disclosure timeline is promised; one will be agreed with you rather
than imposed.

## What this repository is

A specification, a JSON Schema, conformance vectors and a checker that reads a
JSON file. It runs no service, holds no data and has no dependencies. The
checker's `verify` command makes one outbound https request to a domain you
name, with a timeout and a size cap, and follows redirects only within that
publisher.

## What is a vulnerability here

- A document the checker accepts that `SPEC.md` says is refused, or the
  reverse — in particular:
  - an `expires` other than the derived value accepted;
  - a `public` or `partner` item accepted with no `promoted` record, or with
    a non-`person/` promoter;
  - a non-public item accepted under `check --served` or `verify`;
  - an unknown, non-`x-` key carried silently.
- `verify` following a redirect to another host, or off https, or reading a
  network failure as `absent`.
- A body that exceeds the size cap being read in full.
- Any input to `check` or `verify` that causes code execution rather than a
  refusal.

## What is not

`intent/1` is a publication format. Anyone can fetch a public projection —
that is the point. Publishing a file at a domain proves someone can write to
that host and nothing more; it is not an identity or an authorisation. A
fragment is somebody else's input: validate before you act on one.
