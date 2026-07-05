---
area: npm-client
status: draft
title: No-progress bound on STANDARD-path registry fetches (packuments + tarballs)
created: 2026-07-04
why: every eddy acquisition path is now stall-bounded (prefetch drain + direct GET/POST streams, PR #107 rounds 5–6), but the standard install's registry fetches still await an unbounded body — a registry/proxy that hangs mid-response parks `npm install` forever; real npm bounds this (make-fetch-happen timeouts + retries)
user_story: As a user on a flaky registry/proxy, I want a stalled packument or tarball fetch to fail loudly (and retry/abort) after a bounded wait, but today the standard install waits forever with no error.
epic: cold-npm-install-speedup
sources: [https://www.npmjs.com/package/make-fetch-happen]
code: [packages/npm-client/src/registry.ts, packages/npm-client/src/eddy-bundle-stream.ts]
---

## Context

Successor to the eddy-scoped `eddy-direct-path-no-progress-bound` item (closed
2026-07-04: `streamTarEntries` bounds — no-progress timeout + byte cap — now
cover the direct GET/POST paths; `drainBounded` covers the prefetch). The SAME
hang class remains on the standard path: `RegistryClient` packument/tarball
fetches consume bodies with no progress bound. Pre-existing on main (not a PR
#107 regression) and shared by every install mode as the final fallback — so a
bound here also caps the worst-case of an eddy decline chain. Parity note: real
npm's `make-fetch-happen` carries fetch timeouts + retries; rifty has neither.

## Open forks (resolve to reach ready)

- Placement: per-call bound in `RegistryClient` vs a shared bounded-fetch
  wrapper reused by eddy paths (`DEFAULT_BUNDLE_STALL_MS` is the reference
  constant).
- Retry semantics: real npm retries idempotent GETs (`fetch-retries`) — decide
  whether a bound without retry is honest parity or half the feature; verify
  against real npm behavior (parity-runner) before shipping.
- Regression shape: a fixture registry that stalls mid-packument and
  mid-tarball → install fails loudly (or retries) within the bound; never a
  silent park.
- REVERSIBLE (client behavior + tests) → CHANGELOG; no ADR.
