---
area: npm-client
status: draft
title: sass-embedded substitution — choose and prove a second real runtime pattern
created: 2026-07-13
why: sass is the most common native dependency in vite projects and forces an explicit choice between an honest upstream twin and a derived runtime adapter
user_story: As a vite user, I want `npm i -D sass-embedded` + an `.scss` import to compile through a real Sass compiler in the browser, but today install hits the native dart-sass binary and fails
epic: popular-packages-shadow-registry
blocked_by: []
sources: [docs/adr/npm-client/0249-shadow-runtime-assets-install-through-the-npm-pipeline-into-a-workbench-content-store.md, docs/adr/npm-client/0188-install-time-shadow-internals-shims-with-companion-pins-and-substitution-provenance.md]
code: [tools/shadow-registry/src/index.ts, packages/npm-client/src/shadow-shims.ts]
---

## Context

Scenario: vite project with `.scss` imports; vite resolves `sass-embedded`
(preferred) or `sass`; `npm run dev` must compile styles with a real Sass
implementation and real error output. Delivery and adaptation are separate:
first prove Vite's real API/protocol/lifecycle against an exact Node Sass oracle,
then choose how any required heavy bytes arrive. Never approximate either.

- Pattern 1 (upstream pure-JS/twin): candidate targets are `sass` or an upstream
  wasm dart-sass build. It uses no asset manager when there are no heavy runtime
  bytes; `sass-embedded` protocol and async compiler differences still need
  differential proof.
- Pattern 2 (derived runtime adapter + declared assets): if no honest twin
  covers Vite's usage, derive from upstream with pinned patches. The explicit
  adapter owns API/lifecycle parity; `ShadowAssetManager` owns only exact byte
  delivery (ADR-0249).

Vite's legacy/modern API, `css.preprocessorOptions.scss`, compiler reuse,
shutdown, warnings, and real error output are the parity anchor. Unsupported
protocol/API versions throw `NotImplementedError` + compat ❌. If Pattern 2
makes Sass the named second derived-runtime capsule, promote/build
`process-meta/shadow-capsule-selective-ci`; Pattern 1 does not satisfy that
trigger.
