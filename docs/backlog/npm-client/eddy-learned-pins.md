---
area: npm-client
status: ready
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

## Decisions (pre-resolved — ADR-0194)

- Persistence: `/.rifty/eddy-learned-pins.json` on the owner VFS (dot-dir precedent `VfsTarballCache`), NOT localStorage — survives the profile with the trees it describes. TTL 1800s (= server mutable default), cap 64 evict-oldest, corrupt = absent.
- Hash source: new public `InstallResult.closureHash` (set iff `source==='eddy'`) — threaded `consumeEddyResponse` → `tryEddyFastPath` → `install()`.
- Key: `canonicalEddyRequestKey(eddyRequestFromPackageJson(text))`, computed AFTER the merged package.json write; learned entries live only under the `prefer:'cached'` key. Env pin wins over learned; write-back fire-and-forget.
- Seam: `NpmShellCommandDeps.learnedPins?: {get(key): Promise<string|undefined>; set(key, hash): Promise<void>}`.
- Prefetch stays SYNC (double-POST regression otherwise) → module exports async(Vfs) + sync(FsSync) readers; `primeInstallPrefetch` reads the pin via `FsSync.readFileBytesSync`.
- Preconnect quick-win excluded — already implemented (`boot.ts` injectPreconnects).

## Acceptance

- Second fresh-profile install of an identical dep set on the same browser serves the bundle from HTTP cache/CDN edge (0 origin POST), measured via probe request log.
- Canonical-key mismatch (any dep change) never serves a stale bundle — falls to POST; RED-check via probe with a mutated dep set.
- No silent approximation: learned entry corrupt/missing → indistinguishable from no-pin (POST), never an error.
- Warm-path non-regression: existing prefetch invariants (`eddy-prefetch.test.ts`, `install-stamp.test.ts`) stay green; env-pin flow byte-identical when no learned entry exists.

## Out of scope

- Sharing learned pins across browsers/users (that's the env-pin workflow).
- Delta bundles / client-known-tarball exclusion.
