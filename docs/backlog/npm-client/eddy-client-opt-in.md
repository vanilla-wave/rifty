---
area: npm-client
status: ready
title: Eddy client opt-in seam
created: 2026-06-28
why: the eddy speedup must be a public, opt-in option that SDK embedders and self-hosters can enable (not a playground-private fast lane), default-OFF, and must never fail or corrupt an install when the fast path is down
user_story: As an SDK embedder building my own sandbox I want to flip a documented option to give my users the ~6x fast install, but today there is no public seam and no safe fallback contract.
epic: fast-install-resolver
sources: [docs/adr/npm-client/0182-eddy-opt-in-fast-install-resolver.md]
code: [packages/npm-client/src/installer.ts, packages/npm-client/src/tarball-cache.ts, packages/npm-client/src/registry.ts]
---

## Context

The fast path reuses everything that exists: an `EddyBundleV1` is consumed by pre-seeding the `VfsTarballCache` (keyed `name@version`+integrity) + writing `package-lock.json` to cwd, after which the EXISTING `install()` takes the lockfile fast path (ADR-0023) with zero packument network. So the only new client code is "fetch bundle → seed cache → write lockfile → call install()", plus the opt-in plumbing and the fallback. Public option re-exported via `@riftydev/sdk`. Decision record: ADR-0182 §4-5.

## Acceptance

- `InstallOptions` gains `resolverUrl?: string` + `prefer?: 'cached' | 'online'`, re-exported via `@riftydev/sdk`. Default OFF; `resolverUrl` is read only from explicit env-config (D-004) — never a baked default.
- When set + reachable: client fetches `EddyBundleV1`, pre-seeds the tarball cache + writes the lockfile, then `install()` runs the lockfile fast path with zero packument network; `prefer:'online'` is forwarded to eddy.
- Bytes-vs-bundle-integrity verification is non-disableable (reuses the `EINTEGRITY` check); the install result exposes which path ran (eddy vs standard) for provenance.
- On ANY failure — unreachable, HTTP error, malformed bundle, integrity mismatch, lockfile coverage gap, or an eddy "unsupported" decline — the client auto-runs the standard verifying `install()`; it warns, never throws-because-fast-path-down, and never produces a partial/wrong tree.
- A `trust-model.md` (loud-throw register) documents the mirror-grade boundary: bytes are verified against the bundle, NOT against npm's source-of-truth.

## Parity cases

- Fast-path result ≡ standard `install()` result for express@^4 + eslint@^9 (identical node_modules tree + lockfile).
- A bundle with one integrity-mismatched tarball → client falls back to standard install (NOT a silent wrong install).
- An unreachable / 5xx resolver → standard install completes normally (warned).
- A resolver lockfile that does not cover the requested deps → fallback to standard (no partial install).
- `resolverUrl` unset → behavior byte-identical to today's standard install (the option is inert when off).

## Out of scope

- A pluggable client `ClosureSource` injection (ADR-0182 §4: URL seam only for v1; `resolverUrl` is forward-compatible with generalizing later).
- Independent verification against npm's source-of-truth packument (mirror-grade trust, ADR-0182 §5).
- Making fast mode default-ON in any package, preset, or the SDK.
- Signed-manifest verification (deferred with eddy's signing, ADR-0182 §5).

## Decisions

- Public option, not playground-private (ADR-0182 §4) — SDK/self-host parity with rifty.dev.
- URL seam, not pluggable source, for v1 (ADR-0182 §4).
- Mirror-grade trust + non-disableable bytes integrity (ADR-0182 §5).
- Auto-fallback to standard on every failure mode (ADR-0182 §5); fail-soft, never fail-because-optimization.
- `trust-model.md` ships with this item, in the loud-throw register.
