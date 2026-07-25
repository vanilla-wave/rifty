---
kind: epic
status: in-progress
title: Eddy — opt-in fast npm install (production auto 1.88x measured)
created: 2026-06-28
value: A developer running a cold `npm install` on a real project in a browser tab gets it meaningfully faster — the same real Node dependency tree, just resolved + bundled by an open, self-hostable server instead of a serial metadata waterfall.
user_story: As a developer or SDK embedder, I want cold no-lockfile installs to skip the latency-bound packument and tarball waterfalls without changing dependency fidelity; production `auto` is measured at 1.88x, while the h2/h3 transport matrix remains the final headline-validation gap.
items: [perf/eddy-http3-cold-validation, distribution/eddy-package-and-deploy]
---

## Outcome

`eddy` (`@riftydev/eddy`) is an opt-in server that imports
`@riftydev/npm-client`, resolves with rifty's own algorithm, and returns one
`EddyBundleV1` artifact: v3 lockfile plus compressed tarballs. The client
pre-seeds its tarball cache, writes the lockfile, and runs the existing lockfile
fast path. Standard install remains the always-on verifying fallback.

Production `auto` benchmark (2026-07-07, median-of-5) is **1.88x**: standard
5180ms → eddy 2761ms, with both production origins observed as h2 in the
committed artifact. The old "~6x" number is only the pre-deploy Node/sandbox
model; do not quote it as the browser launch number. The remaining epic gap is
the transport-qualified validation: the committed artifact does not yet carry
the full h2/h3 matrix evidence required to close `perf/eddy-http3-cold-validation`.

## User scenario

A developer opens a from-scratch preset or writes a package.json, runs
`npm install` with fast mode enabled via `resolverUrl`, and gets a materially
faster install with real package versions, integrity checks, layout, and
lockfile replay. If eddy is absent, unreachable, stale, malformed, or fails
coverage/integrity gates, the standard verifying install runs instead.

## Items

- `perf/eddy-http3-cold-validation` — open headline-validation gap: commit a
  real-browser transport matrix artifact or keep h3 unquoted. (ready)
- `distribution/eddy-package-and-deploy` — delivered except first npm publish,
  which is operator-confirm-first and user-deferred. (ready)

Delivered and removed from the backlog: resolver service, client opt-in,
wire protocol v1.1, learned pins, S3 durable bundle store, direct npmjs upstream
flip, and the production auto benchmark update.

## Out of Scope

- Quoting h2/h3 results without a committed matrix artifact.
- Independent npm source-of-truth re-verification in the client; that would
  reintroduce the metadata waterfall eddy removes.
- Publishing `@riftydev/eddy` without explicit operator confirmation.
