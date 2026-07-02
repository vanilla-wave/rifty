---
area: npm-client
status: draft
title: eddy learned pins — persist request-key→closureHash, GET-by-hash for any dep set
created: 2026-07-02
why: pins (cacheable CDN GET /bundle/<hash>) are env-config per TEMPLATE today; arbitrary `npm install` sets always POST the origin — no CDN tier, no browser HTTP cache, full TLS+origin RTT every fresh profile
user_story: As a returning user installing the same deps in a new project I want the bundle to come from the CDN edge/browser cache instead of a fresh origin POST.
epic: fast-install-resolver
blocked_by: []
sources: [docs/adr/npm-client/0186-eddy-wire-protocol-v1-1.md, packages/npm-client/src/installer.ts, apps/playground/src/glue/resolver-config.ts]
---

## Context

Wire protocol v1.1 already supports everything needed: the POST response manifest carries `asOf.closureHash`, and `GET /bundle/<hash>` on `resolverBundleBaseUrl` is immutable + CDN/browser-cacheable. Measured (2026-07-02): warm POST for express+eslint = 0.88s of which ~0.65s is TLS+origin RTT+2.9MB origin transfer; a browser-HTTP-cache GET is ~0.

## Shape

- After a successful POST, persist `canonicalEddyRequestKey → closureHash` client-side (survives the project: localStorage or OPFS at owner level — decide + record).
- Next install with a matching canonical key: attempt `GET /bundle/<hash>` (CDN host) BEFORE POST — same three-attempt ladder as `tryEddyFastPath`, pin source just becomes learned instead of env-only.
- Staleness = the existing pin problem, same policy: hash misses/expires → POST fallback re-learns. TTL on the learned entry should mirror the server's mutable-tier TTL so 'latest' drift converges.
- Adjacent quick win (independent, tiny): preconnect to the resolver origin when a terminal `npm i…` line is being typed / at owner boot for ad-hoc installs — saves the measured ~150ms TLS on the first POST. Prefetch already covers preset boots.

## Acceptance

- Second fresh-profile install of an identical dep set on the same browser serves the bundle from HTTP cache/CDN edge (0 origin POST), measured via probe request log.
- Canonical-key mismatch (any dep change) never serves a stale bundle — falls to POST; RED-check via probe with a mutated dep set.
- No silent approximation: learned entry corrupt/missing → indistinguishable from no-pin (POST), never an error.

## Out of scope

- Sharing learned pins across browsers/users (that's the env-pin workflow).
- Delta bundles / client-known-tarball exclusion.
