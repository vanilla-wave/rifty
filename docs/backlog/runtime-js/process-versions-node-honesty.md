---
area: runtime-js
status: ready
title: Split process identity into Node compatibility and rifty host axes
created: 2026-06-08
why: Dart Sass and other real Node packages select their filesystem-capable path through Node compatibility discriminators, while native provenance must still identify the rifty/wasm host honestly
user_story: As a developer compiling SCSS through Vite, I want Dart Sass to recognize the Node API family and use its filesystem implementation, but today missing `process.release.name` misclassifies rifty as a browser and makes file importers throw
epic: honest-shadow-substitutions
sources: [ADR-0026, ADR-0164, ADR-0322, Node v24 process.release]
code:
  - packages/runtime-js/src/builtins/process-identity.ts
  - packages/runtime-js/src/builtins/process.ts
  - packages/runtime-js/src/ipc/install-process-identity.test.ts
  - tools/node-parity-runner/cases/process/release-identity.case.ts
---

## User scenario

A fresh Vite 7.3.6 project imports SCSS through `sass@1.100.0`. Its exact
`sass.node.js` entry evaluates `process.release.name === 'node'`, selects the
Node filesystem implementation, and resolves a nested partial and custom
importer. Today `release` is absent, so the same entry takes its browser path
and throws `Unsupported operation: fileExists() is only supported on Node.js`.

## Reference contract

Node 24 is the parity target (ADR-0164). A real Node 24 probe supplies the
`process.release` and `process.release.name` data descriptors plus strict-mode
assignment/deletion behavior. Node's v24 `process.release` contract permits a
custom non-release build to expose only `name`; rifty is not built from the
official Node source/header archives.

## Acceptance

- Every no-spec and kernel-spec `NodeProcess` owns a fresh, ordinary,
  extensible `release` object.
- `process.release` and `process.release.name` match Node 24 data descriptors:
  non-writable, enumerable, configurable; `name === 'node'`.
- Strict assignment throws, deletion follows the configurable descriptor,
  extra properties remain addable, and mutations never leak between process
  instances.
- `globalThis.process` and `require('node:process')` expose the same live
  release object in a kernel-seeded Node realm.
- `NODE_PROCESS_IDENTITY` carries the frozen `{ name: 'node' }` seed, while
  each live process materializes its own descriptor-correct object.
- `version === 'v24.0.0'` and `versions.node === '24.0.0'` remain the Node API
  target; `platform === 'rifty'`, `arch === 'wasm'`, and `versions.rifty`
  remain honest host discriminators.
- The exact Dart Sass selector succeeds through the guest module loader.

## Parity cases

1. Real Node 24 vs rifty: `release.name`, both property descriptors, ordinary
   prototype, extensible/unsealed/unfrozen shape.
2. Real Node 24 vs rifty: strict assignment to `release` and `name` throws;
   deleting `name` succeeds; adding an extra property succeeds.
3. No-spec singleton and kernel-spec child expose the same shape, with
   per-instance mutation isolation.
4. Guest `require('node:process').release.name === 'node'`; the full Sass
   CJS/ESM/Vite lifecycle remains the dependent Sass slice's acceptance.

## Out of scope

- Official-build `sourceUrl`, `headersUrl`, `libUrl`, and `lts` metadata.
  They stay absent, as permitted for a custom Node build; invented URLs or LTS
  provenance are forbidden.
- Native Node ABI, `.node` addons, or OS impersonation. `platform` and `arch`
  remain `rifty` / `wasm`.
- Descriptor normalization for older process identity fields; this item pins
  only the new `release` surface.

## Decisions

- ADR-0322 owns the two identity axes. `release.name` selects the compatible
  Node API family; it does not claim a native Node host.
- ADR-0026 remains active and unchanged for honest host identity.
- One `NodeProcess` materializer owns both singleton and spawned-child shape;
  no Sass-specific branch or global process shim is allowed.
- Omitting official distribution fields kills a `provenance-lie`; the
  head-to-head oracle replaces the old self-shaped identity test's
  `frozen-assumption`.
