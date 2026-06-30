---
area: npm-client
status: ready
title: Eddy resolver service (@riftydev/eddy)
created: 2026-06-28
why: cold install pays a ~2s latency-bound packument waterfall + a ~1.7s single-h2-connection tarball phase; a server that resolves once and bundles the tarballs collapses both into one round-trip (~6x), and reusing npm-client's own resolution keeps it byte-faithful
user_story: As a self-hoster (and as rifty.dev) I want a server that turns a dep-set into one downloadable lockfile+tarballs bundle, but today no such service exists and a hand-rolled one would re-implement resolution and drift from real npm.
epic: fast-install-resolver
sources: [docs/adr/npm-client/0182-eddy-opt-in-fast-install-resolver.md]
code: [packages/npm-client/src/installer.ts, packages/npm-client/src/linker.ts, packages/npm-client/src/tarball-cache.ts]
---

## Context

New published Node package `@riftydev/eddy` at `services/eddy/`. It IMPORTS `@riftydev/npm-client` and runs the SAME resolution + `buildLockfile` + ADR-0051 native gate (never a reimplementation), then fetches and bundles the tarballs. Node is the fidelity-correct runtime: it runs the same JS resolution as the client (one algorithm = no drift), and the workload is I/O/cache-bound, not CPU-bound — the warm path is a CDN/disk stream where language is irrelevant. Full decision record: ADR-0182.

## Acceptance

- `@riftydev/eddy` exposes an endpoint: given a dep-set (`dependencies`/`devDependencies`/`optionalDependencies`/`overrides`) it returns an `EddyBundleV1` stream — an (uncompressed) tar containing `package-lock.json` + each `<name>-<version>.tgz` (passed through gzip, NOT re-compressed).
- The lockfile + pins are produced by importing `@riftydev/npm-client`'s resolution + `buildLockfile` + native gate — no second implementation; eddy reports the npm-client version it used.
- Two-tier cache: mutable `dep-set → resolved-closure-hash` (TTL default 1800s, operator-configurable including 0) + immutable `closure-hash → bundle` (CDN-cacheable, 1y). `prefer=online` forces a fresh recompute.
- Every artifact carries an as-of stamp: resolution timestamp + the upstream registry revision/state it resolved against.
- Non-registry / unsupported specs return a typed "unsupported — use standard install" decline, never a synthesized result.
- Published to npm + a Docker image (deploy/publish tracked in `distribution/eddy-package-and-deploy`).

## Parity cases

- Eddy's lockfile ≡ a client live-resolve lockfile for express@^4 + eslint@^9: identical version pins, `resolved` URLs, `integrity`, and installPath set.
- Each tarball in the bundle integrity-matches its lockfile entry (a client `EINTEGRITY` check on the bundle passes).
- The ADR-0051 native gate fires identically server-side: a `cpu`-non-wasm package yields `ENATIVEUNSUPPORTED` and is excluded exactly as the client would skip it (e.g. `@esbuild/*` platform optionals).
- An unconstrained range (`*`/missing) picks `dist-tags.latest` identically to the client.
- The express-diamond layout (`ms@2.1.3` flat / `ms@2.0.0` nested under `finalhandler`) is reproduced in eddy's lockfile.

## Out of scope

- Non-registry specs (`file:`/`link:`/`workspace:`/git/github/`http(s):` tarball/`npm:` alias) and lifecycle scripts: eddy returns the typed decline (client falls back to standard, which throws the existing `NotImplementedError` + compat ❌) — eddy never synthesizes or stubs them.
- The extracted-`node_modules` artifact variant (ADR-0182: 4.3x byte penalty, dominated).
- Signed/attested manifests (ADR-0182: mirror-grade trust only for v1; signing deferred).
- Independent re-verification of pins against npm's source-of-truth (would re-introduce the metadata waterfall).

## Decisions

- Artifact = variant B (`EddyBundleV1` = tar of lockfile + compressed tarballs); extracted-tree variant rejected. (ADR-0182 §3)
- One algorithm: import `@riftydev/npm-client`, never reimplement. (ADR-0182 §2)
- Runtime = Node (fidelity forces JS; workload I/O-bound; warm path is CDN). (ADR-0182)
- Cache backend = disk + in-memory LRU for the mutable tier; immutable tier behind the CDN. REVERSIBLE impl detail, this item.
- TTL default 1800s, operator-tunable incl 0; `prefer=online` escape; as-of stamp mandatory. (ADR-0182 §6)
