---
kind: epic
status: ready
title: Honest shadow substitutions at scale — builtin package-generic registry
created: 2026-07-23
value: Real projects that depend on native-backed packages (esbuild directly or through Vite, sass-embedded) install and run faithfully in the browser through one builtin, parity-proven substitution registry
user_story: As a browser-IDE user, I want npm install of a project using esbuild or sass-embedded to just work — direct require, through Vite, offline on reopen — but today each native binding stops the project or costs a re-acquisition
tier: production
sources: [ADR-0307, ADR-0309, ADR-0310, ADR-0328, PR-160]
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
- adding the Sass capsule after the registry core changes only Sass
  policy/capsule/oracle/fixtures, generated data, compat docs, and acceptance
  tests — the seam proof;
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
4. Adding Sass changes only Sass policy/capsule/oracle/fixtures, generated data,
   compat docs, and acceptance tests.
5. A→B→A with acquisition network disabled reuses the exact tree with zero
   install/registry work; extraneous `node_modules` writes do not break trust.
6. Unsupported versions and surfaces throw named `NotImplementedError` and stay
   compat ❌ without host-byte, native-binary, or approximate fallback.

## Items

Dependency order (slice names = §Budget rows; each source slice gets its own
Contract+RED → Final+GREEN):

1. `playground/vite-temp-install-claim-churn` — **oracle-slice**: stamp trust
   predicate re-scoped per ADR-0307; earliest user payoff (running `vite` no
   longer demotes install trust). Ready; closes delete-on-done when its
   acceptance branches are fully proven.
2. `playground/workbench-package-extraction` — **workbench-extraction**:
   mechanical subtraction from the #160 quarry (renames, sealed entrypoints,
   installer per-edge replay + direct-slot reservation); hard cut line, nothing
   touching trust/epoch/shadow. May proceed in parallel with the decision PR.
3. `npm-client/shadow-recipe-v2-data-authority` —
   **recipe-v2-data-authority**: strict clone-safe schema 2, data-owned
   admission features, and one side-effect-free package-private ingress.
4. `npm-client/shadow-recipe-v2-authority` —
   **recipe-v2-authority**: consumes the data-authority prerequisite, then owns
   exact acquisition execution, materialized bins, and strict replay authority
   discovered by the Sass contract; required before the package-specific seam.
5. `npm-client/sass-embedded-substitution` — **sass-scale-proof**: exact Sass
   capsule per the spike-decided pattern, real Node/Vite acceptance,
   generic-file no-change gate. Required for epic closure, not optional.
6. `playground/shadow-series-measured-cleanup` — **measured-cleanup**:
   independently deletable leftovers behind reachability gates (arch exemption
   narrowing, owner READMEs, dead code imported by extraction).

The quarry's conditional Vite temp-cache slice is dead: the ADR-0307 probe
passed, so no temp-cache is ported and Vite writes temp modules to the real
VFS. Seam accounting: Sass forces the registry/materialization seam; the
runtime-asset seam stays N=1 (esbuild) and its generalization claim stays
withdrawn until a second Pattern-2 package lands
(hook: sharp/libvips-wasm, capture-gated, not a promise).

## Budget

Run tripwires (`docs/backlog/README.md` §Budget):

- scope implemented outside `ready` items: 0
- in-place ready-contract edits alongside source changes: 0
  (`pnpm check:contract-drift`)
- new coordination mechanisms: 0
- review checkpoints per slice: exactly 2
- generated globs: `docs/public/compat/**`, `**/generated/**`, `pnpm-lock.yaml`
- slices:

| slice | band |
|---|---|
| oracle-slice | 300–1000 |
| workbench-extraction | 2000–4000 |
| recipe-v2-data-authority | 1200–2500 |
| recipe-v2-authority | 1800–3000 |
| sass-scale-proof | 1000–3000 |
| measured-cleanup | 1000–3000 |
