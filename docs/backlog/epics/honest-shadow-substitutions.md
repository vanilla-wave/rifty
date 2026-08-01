---
kind: epic
status: ready
title: Honest shadow substitutions at scale — builtin package-generic registry
created: 2026-07-23
value: Real projects that depend on native-backed packages (esbuild directly or through Vite, sass-embedded) install and run faithfully in the browser through one builtin, parity-proven substitution registry
user_story: As a browser-IDE user, I want npm install of a project using esbuild or sass-embedded to just work — direct require, through Vite, offline on reopen — but today each native binding stops the project or costs a re-acquisition
tier: production
sources: [ADR-0307, ADR-0309, ADR-0310, ADR-0335, PR-160]
goal_baseline: e34bd3db82c5088f57c32934b3a45b001b578d3e
---

## Outcome

One builtin package-generic shadow-substitution registry (ADR-0328): a recipe
owns trigger/version, exact materialization/provenance, and an OPTIONAL runtime
binding dispatched through one owner-bundled executable-adapter registry.
Non-negotiable merge outcome:

- a normal Workbench project installs exact `esbuild`, then direct guest
  `require('esbuild')` and `import('esbuild')` run the proven `transform()`
  surface without Vite installed or recognized;
- Vite 7.3.6 dev/build/preview/optimize uses the same esbuild adapter and
  npm-proven bytes; Vite-specific recognition exists only inside the concrete
  Vite/esbuild integration edge;
- a fresh project pins `sass-embedded@1.100.0`, imports SCSS, and passes direct
  CJS/ESM Sass lifecycle parity plus real Vite 7.3.6 dev/HMR/build acceptance;
- the Sass substitution creates no runtime binding or asset capability and
  performs zero runtime manager/store operations while direct and Vite Sass
  behavior remains faithful;
- unsupported versions/surfaces stay named `NotImplementedError` + compat ❌ —
  no fallback to host bytes, native binaries, or approximate output.

`tier: production` because reload/offline storage consistency is part of the
user scenario (A→B→A offline reuse, crash/reload honesty).

## User scenario

On a fresh Chromium profile a user opens a Vite 7.3.6 project, waits for
install and LIVE preview; running `vite` (its config loader writes into
`node_modules/.vite-temp`) leaves Scratch clean and install trust intact. In a
terminal, `node -e "require('esbuild').transform('let x=1').then(r =>
console.log(r.code))"` returns the proven output without Vite involvement. They add `sass-embedded@1.100.0` plus
an SCSS import; dev renders exact CSS, edit HMRs, build emits matching
CSS/map. They switch to another project and back with acquisition network
disabled; the tree is reused offline with zero install/registry work. Closing
smoke proves these coarse invariants: direct-esbuild activation, Vite parity
through the same adapter, Sass lifecycle parity, and trust surviving extraneous
`node_modules` writes.

## Invariants

1. Direct guest `require('esbuild')` and `import('esbuild')` run the proven
   `transform()` surface without Vite installed or recognized.
2. Vite 7.3.6 dev/build/preview/optimize uses the same esbuild adapter and
   npm-proven bytes; recognition remains inside the concrete Vite/esbuild edge.
3. `sass-embedded@1.100.0` passes direct CJS/ESM lifecycle parity and real Vite
   7.3.6 dev/HMR/build acceptance with exact CSS/map output.
4. The Sass substitution creates no runtime binding or asset capability and
   performs zero runtime manager/store operations.
5. A→B→A with acquisition network disabled reuses the exact tree with zero
   install/registry work; extraneous `node_modules` writes do not break trust.
6. Unsupported versions and surfaces throw named `NotImplementedError` and stay
   compat ❌ without host-byte, native-binary, or approximate fallback.

## Items

Dependency order (slice names = §Budget rows; each source slice gets its own
Contract+RED → Final+GREEN):

1. `playground/vite-temp-install-claim-churn` — **oracle-slice**: landed the
   ADR-0307 predicate re-scope.
2. `playground/vite-temp-install-claim-churn` — **save-trust-rebind**: closes
   the retained Save-inclusive browser branch through ADR-0329, without
   reacquisition or a second package-state mechanism. Ready after the fresh
   recut verdict; delete-on-done only after every original Acceptance branch
   is proven.
3. `playground/workbench-package-extraction` — **workbench-extraction**:
   mechanical subtraction from the #160 quarry (renames, sealed entrypoints,
   installer per-edge replay + direct-slot reservation); hard cut line, nothing
   touching trust/epoch/shadow. May proceed in parallel with the decision PR.
4. `npm-client/shadow-recipe-v2-data-authority` —
   **recipe-v2-data-authority**: strict clone-safe schema 2, data-owned
   admission features, and one owner-decoded frozen internal catalog.
5. `npm-client/shadow-recipe-v2-authority` —
   **recipe-v2-authority**: blocked pre-pickup predecessor; its six recorded
   Contract+RED blockers forced explicit materialized-bin,
   acquisition/replay, and broad projection successors. No source pickup.
6. `npm-client/sass-embedded-substitution` — **sass-scale-proof**: exact Sass
   capsule per the spike-decided pattern, real Node/Vite acceptance,
   generic-file no-change gate. Draft until its full differential artifact and
   fault matrix are committed; required for epic closure, not optional.
7. `playground/shadow-series-measured-cleanup` — **measured-cleanup**:
   independently deletable leftovers behind reachability gates (arch exemption
   narrowing, owner READMEs, dead code imported by extraction).
8. `npm-client/resolved-package-linker-path-authority` —
   **resolved-package-linker-path-authority**: terminal install-path split for
   one exact raw `ResolvedPackage.installPath` grammar and zero-effect
   rejection through direct preflight plus the four `linker.ts` consumers.
9. `npm-client/resolved-package-installer-prepared-path-consumption` —
   **resolved-package-installer-prepared-path-consumption**: real installer
   consumes the linker-owned prepared path once across target preparation,
   prepared linking, and prepared lock construction.
10. `npm-client/package-bin-claim-normalization-authority` —
    **package-bin-claim-normalization-authority**: terminal blocked predecessor;
    its two Contract+RED checkpoints forced separate source-normalization and
    claim-settlement successors. No source pickup.
11. `npm-client/package-bin-source-normalization-authority` —
    **package-bin-source-normalization-authority**: terminal blocked
    predecessor; its two Contract+RED checkpoints forced separate per-source
    claim and ordered-aggregation successors. No source pickup.
12. `npm-client/package-bin-source-claim-authority` —
    **package-bin-source-claim-authority**: one strict source becomes exact
    detached claims once, with no list aggregation, settlement, VFS, or compat.
13. `npm-client/package-bin-claim-aggregation-authority` —
    **package-bin-claim-aggregation-authority**: one readonly mixed source list
    becomes exact ordered claims without settlement, VFS, or public API.
14. `npm-client/package-bin-claim-settlement-authority` —
    **package-bin-claim-settlement-authority**: compose landed aggregation for
    exact current/optional-prior sources; settle by scope plus command, returning
    current claims unchanged or the exact npm-reify ceiling, without VFS/public API.
15. `npm-client/package-bin-claim-link-ingress-authority` —
    **package-bin-claim-link-ingress-authority**: compose settled claims once at
    the prepared linker convergence point before any VFS mutation; keep the root
    public, cancellable, and prepared paths plus compat honesty in lockstep.
16. `npm-client/package-bin-companion-claim-admission-authority` —
    **package-bin-companion-claim-admission-authority**: keep injected support
    packages installed with truthful metadata while only ordinary per-path
    demand admits their package-bin claims.
17. `npm-client/package-bin-phased-linker-authority` —
    **package-bin-phased-linker-authority**: settle every prepared package file
    before one detached shaped-claim launcher pass across public, cancellable,
    prepared, and direct phased paths; keep target/abort/VFS faults and exact
    retry loud.
18. `npm-client/shadow-materialized-bin-commit-authority` —
    **shadow-materialized-bin-commit-authority**: compose exact recipe claims
    and acquired-twin suppression before shared current/prior preflight, then
    package files → registry aliases → one bin pass → internals shims → lock →
    staged reports without a second writer, reporter, or scheduler.
19. `npm-client/shadow-recipe-v2-acquisition-replay-authority` —
    **shadow-recipe-v2-acquisition-replay-authority**: verify the exact
    LightningCSS registry projection before acquisition effects and validate
    the official tarball's embedded manifest at the shared fresh/replay/Eddy
    ingress before link effects.
20. `npm-client/shadow-recipe-v2-embedded-source-authority` —
    **shadow-recipe-v2-embedded-source-authority**: consume the validated
    bundled child without standalone traversal/cache/tree/bin, publish exact
    parent bundle plus embedded-child lock facts, and preserve that topology
    through current-protocol replay and generic Eddy completeness.
21. `npm-client/shadow-recipe-v2-protocol-replay-authority` —
    **shadow-recipe-v2-protocol-replay-authority**: dependency-ordered split
    after embedded-source topology; publish and consume exact protocol-v2
    trace/bin facts, replay literal root/nested locks offline, validate cached
    embedded evidence, and prove Eddy, Workbench FIFO, and Chromium Vite lock
    consumers. Split lineage: `812cd8b0e5c653674bae949d67f0ac21db90748f`
    then `f5dbb4e021380dbdbbd964e33b434e47c2348618`.

The quarry's conditional Vite temp-cache slice is dead: the ADR-0307 probe
passed, so no temp-cache is ported and Vite writes temp modules to the real
VFS. Seam accounting: Sass forces the registry/materialization seam; the
runtime-asset seam stays N=1 (esbuild) and its generalization claim stays
withdrawn until a second Pattern-2 package lands
(hook: sharp/libvips-wasm, capture-gated, not a promise).

## Budget

Run tripwires (`docs/backlog/README.md` §Budget):

- scope implemented outside `ready` items: 0
- ready-contract edits after pickup: 0
  (`pnpm check:contract-drift`)
- new coordination mechanisms: 0
- generated globs: `docs/public/compat/**`, `**/generated/**`,
  `apps/playground/public/snapshots/**`, `pnpm-lock.yaml`
- slices:

| slice | band |
|---|---|
| oracle-slice | 300–1000 |
| save-trust-rebind | 300–1000 |
| workbench-extraction | 2000–4000 |
| recipe-v2-data-authority | 1200–2500 |
| recipe-v2-authority | 1800–3000 |
| sass-scale-proof | 1000–3000 |
| measured-cleanup | 1000–3000 |
| resolved-package-linker-path-authority | 100–300 |
| resolved-package-installer-prepared-path-consumption | 100–300 |
| package-bin-claim-linker-authority | 300–700 |
| package-bin-claim-preflight-authority | 100–300 |
| package-bin-claim-normalization-authority | 100–200 |
| package-bin-source-normalization-authority | 50–120 |
| package-bin-source-claim-authority | 30–80 |
| package-bin-claim-aggregation-authority | 20–60 |
| package-bin-claim-settlement-authority | 30–80 |
| package-bin-claim-link-ingress-authority | 20–80 |
| package-bin-companion-claim-admission-authority | 30–100 |
| package-bin-phased-linker-authority | 100–300 |
| shadow-materialized-bin-commit-authority | 100–300 |
| shadow-recipe-v2-acquisition-replay-authority | 300–800 |
| shadow-recipe-v2-embedded-source-authority | 200–500 |
| shadow-recipe-v2-protocol-replay-authority | 300–800 |
