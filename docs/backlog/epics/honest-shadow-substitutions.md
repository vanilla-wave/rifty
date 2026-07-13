---
kind: epic
status: ready
title: Honest shadow substitutions at scale
created: 2026-07-13
value: Substituted native packages install real, integrity-pinned runtime bytes through the npm pipeline — offline-durable, eddy-accelerated, and cheap to extend to the next package
user_story: As a browser-IDE user with a vite project, I want install to deliver every substituted package's executed bytes with npm-grade provenance, but today esbuild's wasm arrives outside npm as an app-bundle asset while install downloads ~20MB of dead alias bytes
items: [npm-client/shadow-asset-store, npm-client/eddy-batch-asset-closure, npm-client/esbuild-alias-override-retirement, npm-client/sass-embedded-substitution, process-meta/shadow-capsule-selective-ci, npm-client/external-shadow-registries]
---

## Outcome

A substitution is data, not bespoke plumbing: a shim entry declares its trigger,
overlay files, and integrity-pinned runtime assets; the assets arrive at install
time through the existing tarball pipeline into a workspace content store
(ADR-0249). Executed bytes get the same provenance as every dependency; the
playground bundle stops carrying wasm; the dead ~20MB alias download dies; eddy
(opt-in) delivers the whole asset set as one immutable bundle GET. Proof cost
stays per-package-on-change (capsule CI), so the pattern scales from 2 packages
(esbuild, lightningcss) to the named next consumers — sass-embedded, then
@swc/core and sharp — without per-PR test explosion. Mission anchor: real Node
software needs real tool bytes the user can audit.

## User scenario

A user opens a vite project and runs `npm i` + `npm run dev`. During install,
esbuild's shim applies and `esbuild.wasm` fills the store through the same
pipeline as every tarball (eddy on: one learned-pin GET for the whole asset
set). The first `vite build` reads the store — no 13.3MB surprise fetch; after
the browser evicts its HTTP cache, reload still works offline. An app update
that bumps the esbuild pin changes the store key: the next action fetches
exactly the new bytes or fails loud, never runs stale ones. The same user adds
`sass-embedded` to the project: install substitutes it through the identical
declared-assets path — no new delivery mechanism. A contributor adding that
sass capsule touches only its capsule directory; PR CI runs that capsule's
proof suite plus cheap always-on drift gates, not every capsule's oracle.

## Items

- `npm-client/shadow-asset-store` — core: asset pins on shim entries, ensure
  into the workspace content store, STD registry transport, playground bundle
  asset removed (ready; ADR-0249).
- `npm-client/eddy-batch-asset-closure` — opt-in accelerator: one batch
  closure for the full asset-pin set, learned-pin fast path, STD fallback
  (ready; blocked by the store).
- `npm-client/esbuild-alias-override-retirement` — kill the dead ~20MB alias
  download; entry gate = the real-Vite e2e measurement; subsumes the former
  `esbuild-substitution-strategy-reconciliation` (draft).
- `npm-client/sass-embedded-substitution` — second real consumer; proves the
  declared-assets pattern generalizes (draft).
- `process-meta/shadow-capsule-selective-ci` — capsule layout + digest-keyed
  selection so n capsules cost O(changed) expensive suites per PR (ready;
  build trigger = the second pattern-2 capsule).
- `npm-client/external-shadow-registries` — registry becomes a public-API
  value so embedders plug their own substitutions (draft; ADR before ready;
  consumed by epic `embeddable-dev-loop`).
