---
area: npm-client
status: draft
title: Shadow recipe v2 protocol and replay authority
created: 2026-08-02
why: the acquisition re-cut leaves current lock traces unable to prove complete recipe behavior or replay the embedded source offline without trusting incomplete provenance
user_story: As a browser-IDE user reopening an installed project, I want the exact acquired source, materialized files, bins, and lock evidence replayed offline, but today protocol v1 rejects the reviewed v2 facts and incomplete traces can hide drift
epic: honest-shadow-substitutions
blocked_by: npm-client/shadow-recipe-v2-acquisition-replay-authority
sources: [ADR-0335, docs/backlog/npm-client/reference/shadow-recipe-v2-contract-red.md]
code:
  - packages/npm-client/src/installer.ts
  - packages/npm-client/src/internal/shadow/planner.ts
  - packages/npm-client/src/installer-lockfile-reader.ts
  - packages/npm-client/src/linker.ts
  - packages/workbench/src/workers/package-acquisition-authority.ts
---

## Context

Standards review blocked combined checkpoint
`812cd8b0e5c653674bae949d67f0ac21db90748f`: its two TypeScript carriers plus
Workbench and Chromium additions exceeded twice the acquisition slice budget,
and ten replay rows prescribed an unratified nested error-cause shape. The
dependency-ordered predecessor now owns only exact fresh acquisition and the
embedded source. This draft starts only after that item lands, then extends the
same installer/planner/linker seam with complete protocol-v2 provenance and
offline replay. It adds no public API, resolver, cache, lock, FIFO, scheduler,
or shadow-specific Eddy source.

## Reference contract

- ADR-0335 keeps lockfile provenance authoritative: matching replay regenerates
  exact files and bins without registry reads; recipe-v1 identity and behavior
  drift fail `EBROKENLOCK` with `shadow-trace-drift`.
- The acquisition predecessor supplies exact LightningCSS registry maps, the
  SRI-verified real `lightningcss-wasm@1.32.0` tarball, the embedded
  `napi-wasm@1.1.3` manifest/members, and truthful fresh lock facts. This item
  serializes and consumes those already-attested facts; it does not re-own
  acquisition policy.
- The materialized-bin successor supplies the sole files → aliases → bins →
  shims → lock → reports commit boundary and canonical bin facts.

## Acceptance

- Emit `rifty.shadow-substitutions/v2` traces containing the exact schema-2
  catalog/recipe identities; complete acquisition required/optional/peer and
  bundle maps; exact bundled-child `name`, `version`, and `inBundle: true`; and
  materialization install path, files, and canonical bin map. Strict decoding
  rejects missing, extra, malformed, or disagreeing behavior fields.
- Keep schema-1 identity detection ahead of generic protocol rejection and
  attribute the canonical-first legacy package exactly as ADR-0335 requires.
- A literal reviewed v2 lock/trace, independent of the production attester,
  replays root and nested LightningCSS plus esbuild trees with zero packument or
  tarball reads. It consumes only the exact pinned cache entries, regenerates
  byte-identical files, aliases, and bins, emits the same reports, and leaves
  raw lock bytes unchanged.
- Before any VFS, report, or lock mutation, independently changing acquisition
  dependencies, optional dependencies, peer dependencies, bundle membership,
  bundled-child version or `inBundle`, materialization files, or
  materialization bin facts fails `EBROKENLOCK` with
  `shadow-trace-drift`. Tests require the public error contract, not an
  unrecorded nested `cause` representation.
- Cache replay rechecks integrity and the embedded child's manifest identity,
  exact version/range, and bundle placement before linking. Missing, corrupt,
  or substituted parent/embedded bytes fail loudly after only the necessary
  bounded cache reads and before tree/report/lock mutation.
- Eddy bundle adoption applies the same v2 trace and embedded-source checks.
  Its completeness gate accepts only the acquisition-plan-proven bundled child
  without a standalone tarball entry; every other reachable lock package still
  requires its ordinary source. No Eddy failure becomes registry fallback and
  no shadow-specific Eddy acquisition path returns.
- Two supported Workbench installs targeting one project remain physically
  serialized by the existing owner FIFO through materialized files, bins,
  reports, and lock commit. While the first real npm-client install is parked
  before lock publication, the second cannot enter the core or write.
- Real Chromium Vite 7.3.6 dev/build/preview/optimize remains green through the
  same esbuild adapter. Its actual project lock contains protocol v2, exact
  catalog/recipe identities, trace `materialization.bin`, canonical
  `bin/esbuild`, and the unchanged loud `NotImplementedError('esbuild.cli')`;
  direct CJS/ESM esbuild remains differential-green against real Node.
- Preserve completed data, acquisition, materialized-bin, catalog/install/
  snapshot identity, and registry bounded-read/cancellation suites. Add concise
  npm-client, Workbench, and playground CHANGELOG entries.

## Parity cases

1. Literal root and nested v2 locks replay LightningCSS and esbuild offline to
   the same bytes, aliases, bins, reports, tree, and raw lock bytes as fresh
   install, with exact cache and zero registry/tarball ledgers.
2. Every acquisition, bundled-child, files, and bin trace field mutates alone
   to `EBROKENLOCK`/`shadow-trace-drift` before observable mutation; no test
   depends on an unratified `cause` shape.
3. Cached parent or embedded-manifest corruption fails before link/report/lock;
   the exact acquisition-plan-proven embedded child needs no standalone source.
4. Eddy adoption accepts the same complete embedded topology and rejects an
   unexplained missing ordinary tarball member without falling back.
5. Same-project Workbench installs enter the real core in FIFO order and the
   second stays outside until the first complete commit settles.
6. Real Chromium Vite 7.3.6 completes dev/build/preview/optimize with exact v2
   lock/bin facts; direct CJS/ESM and loud CLI behavior remain unchanged.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| corrupt-input / provenance-lie | strict-decode and compare every v2 acquisition/materialization/bundled-child field; cache bytes and embedded manifest must match | independent literal-lock and cache mutation tables |
| observable-order | full lock/trace validation precedes cache selection; cache/embedded validation precedes VFS/report/lock mutation | exact root/nested operation ledgers |
| poisoned-cache / provenance-lie | only pinned parent sources are read; wrong integrity, bytes, child identity, version, range, or placement reject before link | root/nested parent and embedded-manifest corruption table |
| unbounded-read | cache/tar decoding and inherited registry reads retain their bounded/cancellable owners | inherited extraction and `RegistryClient` fault suites |
| torn-state | abort or failure during aliases/bins/lock emits no later report/result/lock and exact retry reconciles | inherited root/nested materialized commit matrix plus replay retry |
| quota-perm-fail | alias/bin/lock `ENOSPC`/`EACCES` stays loud, publishes no false success, and exact retry reconciles | inherited commit faults exercised with v2 replay |
| concurrent-same-key | existing Workbench owner FIFO excludes a second same-project install until first lock/report settlement | real-core park before lock publication |
| sibling-drift | fresh, replay, Eddy, Workbench, direct esbuild, and Vite consume one generic attested plan/trace | literal carrier, finite generic-source gate, Workbench and Chromium acceptance |

## Out of scope

- Exact fresh registry projection and embedded-source acquisition; predecessor
  `npm-client/shadow-recipe-v2-acquisition-replay-authority` owns them.
- Matching non-bundled required/retained-optional traversal, omitted optionals,
  non-empty peer handoff, and accepted scoped keys;
  `npm-client/shadow-recipe-v2-dependency-projection-execution` owns them.
- npm same-command collision settlement; it remains
  `NotImplementedError('npm-client.bin-collision-reify')` + compat ❌ under
  `npm-client/npm-11-bin-reify-authority`.
- Peer placement, Sass, a public/custom recipe SPI, raw concurrent public
  `install()`, a shadow-specific Eddy source, or any second resolver, cache,
  lock, FIFO, scheduler, or coordination mechanism.

## Decisions

- `split-predecessor:
  812cd8b0e5c653674bae949d67f0ac21db90748f`; Standards required the combined
  acquisition/replay checkpoint to split before implementation. This is the
  second dependency-ordered unit and stays draft behind the narrowed
  acquisition item.
- Protocol v2 carries behavior-complete data already attested by existing
  owners; no new codec, public API, or coordination mechanism is introduced.
- Replay mutation cases assert ADR-0335's public `EBROKENLOCK` reason only.
  Nested error-cause presence or absence is not observable contract.
- General Eddy remains the standard source path. This item changes only lock
  adoption/completeness where the attested acquisition plan proves an embedded
  child; it does not restore the rejected shadow-specific Eddy path.
- Workbench and Chromium are acceptance consumers of the same core protocol,
  not alternate trace, FIFO, linker, or package-specific owners.
