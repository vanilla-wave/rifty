---
area: npm-client
status: draft
title: sass-embedded substitution — second real consumer of the declared-assets pattern
created: 2026-07-13
why: sass is the most common native dependency in vite projects; it is also the scale-proof that shadow substitution generalizes beyond esbuild
user_story: As a vite user, I want `npm i -D sass-embedded` + an `.scss` import to compile through a real Sass compiler in the browser, but today install hits the native dart-sass binary and fails
epic: honest-shadow-substitutions
blocked_by: [npm-client/shadow-asset-store]
sources: [docs/adr/npm-client/0249-shadow-runtime-assets-install-through-the-npm-pipeline-into-a-workspace-content-store.md, docs/adr/npm-client/0188-install-time-shadow-internals-shims-with-companion-pins-and-substitution-provenance.md]
code: [tools/shadow-registry/src/index.ts, packages/npm-client/src/shadow-shims.ts]
---

## Context

Scenario: vite project with `.scss` imports; vite resolves `sass-embedded`
(preferred) or `sass`; `npm run dev` must compile styles with a real Sass
implementation and real error output. Refinement must decide the pattern
against actual upstream artifacts, never approximate:

- Pattern 1 (alias to an upstream twin, like `lightningcss` →
  `lightningcss-wasm`): candidate targets — pure-JS `sass`, or a wasm build of
  dart-sass; API surface differences vs `sass-embedded` (embedded protocol,
  async compiler API) must be verified against the real packages, not assumed.
- Pattern 2 (derived runtime + declared asset pins, like esbuild): if no
  honest twin covers vite's usage, derive from upstream with pinned patches
  and ship the heavy artifact through the shadow asset store (ADR-0249).

Whatever the pattern, assets ride `ensureShadowAssets` — no new delivery
mechanism. This item is also the build trigger for
`process-meta/shadow-capsule-selective-ci` (second pattern-2 capsule) if
pattern 2 is chosen. Vite's sass invocation paths (legacy vs modern API,
`css.preprocessorOptions.scss`) are the parity anchor; oracle = the real
compiler in Node at an exact pinned version.
