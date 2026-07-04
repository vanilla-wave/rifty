---
area: npm-client
status: draft
title: No-progress bound on the installer's DIRECT eddy GET/POST streaming reads
created: 2026-07-04
why: the prefetch eager-drain got a no-progress timeout + byte cap (round-5 fix, PR #107) — but the installer's own pinned-GET and POST attempts still stream unbounded; a server that sends a covering manifest+lockfile then hangs mid-tarball parks `npm install` forever with no error and no fallback (same hang class, different path)
user_story: As a user on a flaky resolver/CDN, I want a stalled bundle download to fall back to the standard install after a bounded wait, but today only the PREFETCH path is stall-bounded — a direct GET/POST that hangs mid-body waits forever.
epic: fast-install-resolver
sources: [docs/adr/npm-client/0194-eddy-v1-2-stateless-bundle-store-shared-resolve-caches-learned-pins.md]
code: [packages/npm-client/src/installer.ts, packages/npm-client/src/eddy-bundle-stream.ts, packages/npm-client/src/eddy-prefetch.ts]
---

## Context

Found by the PR #107 pre-merge contract sweep (invariant: bounded/streaming on ALL
acquisition paths). `consumeEddyResponse` streams and its manifest/lockfile gates
cancel a non-covering bundle early (tested), but a COVERING bundle whose body
stalls mid-tarball has no no-progress bound — `streamTarEntries` awaits
`reader.read()` indefinitely. The standard registry path (packument/tarball
fetches) has the same exposure, so the right bound may belong at a shared fetch
layer, not eddy-only. The prefetch path's bound (`drainBounded`,
`eddy-prefetch.ts`) is the reference shape: no-progress timeout (10s default) +
byte cap, reject → attempt pipeline falls through.

## Open forks (resolve to reach ready)

- Scope: eddy GET/POST only, or a shared no-progress wrapper for ALL install
  fetches (registry packuments/tarballs share the hang class)?
- Bound shape: reuse `drainBounded`'s constants (10s no-progress / 128MB) or
  per-path knobs? A mid-install abort also must leave the tarball cache
  consistent (it does today — verified seeds only) — pin with a test.
- Regression test mirrors `client-roundtrip.test.ts` "NEVER-ENDING prefetch
  body": covering bundle, manifest+lockfile+first tarball sent, then silence →
  install completes via fallback within the bound.
- REVERSIBLE (client behavior + tests) → CHANGELOG; no ADR.
