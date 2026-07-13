---
kind: epic
status: ready
title: Honest shadow substitutions at scale
created: 2026-07-13
value: Substituted native packages install real, integrity-pinned runtime bytes through the npm pipeline — storage-honest, eddy-accelerated, and cheap to extend to the next package
user_story: As a browser-IDE user with a vite project, I want install to deliver every substituted package's executed bytes with npm-grade provenance, but today esbuild's wasm arrives outside npm as an app-bundle asset while install downloads ~20MB of dead alias bytes
items: [npm-client/shadow-asset-store, npm-client/eddy-batch-asset-closure, npm-client/esbuild-alias-override-retirement, npm-client/sass-embedded-substitution, process-meta/shadow-capsule-selective-ci, npm-client/external-shadow-registries]
---

## Outcome

Asset delivery is declared data; runtime adaptation stays explicit,
package-specific, parity-proven code. Applied substitutions yield an exact asset
set; one owner-resident `ShadowAssetManager` produces its readiness receipt
before install reports success and serves verified bytes through an owned Worker
port (ADR-0249). Receipts distinguish `opfs-persisted`, `opfs-best-effort`, and
`memory-session`; the latter two warn and make no stronger reload claim.
Executed bytes get npm provenance; the playground bundle stops carrying wasm;
the dead ~20MB alias download dies; eddy (opt-in) batches only the missing
applied set. Capsule CI keys expensive proof to the complete input closure, so
a package-local change stays local while shared runtime changes select every
affected capsule. Mission anchor: real Node software needs real tool bytes and
runtime behavior the user can audit.

## User scenario

A user opens a vite project and runs `npm i` + `npm run dev`. Install shows
asset fetch/verify/persist progress and exits zero only after the exact applied
`esbuild.wasm` receipt is ready for the reported storage class (eddy warm path:
one learned-pin GET for the missing set; cold path: bounded resolve). Persistent
OPFS survives HTTP-cache eviction and reload offline; best-effort OPFS says the
same only while origin storage remains, and memory is session-only. If asset
delivery fails after the tree is ready, npm exits nonzero with a structured
phase error while the shell stamps the matching tree independently. Vite reads
verified bytes through the owner port — no 13.3MB surprise fetch. An app
update that changes the esbuild pin produces a new receipt: install or restore
fetches exactly the new bytes or fails loud, never runs stale ones. A later
`sass-embedded` substitution reuses this delivery plane only if the derived
runtime pattern wins and its real API/lifecycle adapter passes parity; an honest
pure-JS twin has no declared-asset obligation. A contributor changing one capsule runs
its proof suite; a manager, owner-port, VFS, runtime, or relevant lockfile-input
change selects every affected capsule rather than silently trusting a path list.

## Items

- `npm-client/shadow-asset-store` — core: exact version-to-asset declarations,
  owner-resident manager + Worker port, storage-qualified workspace-private
  receipts, STD transport, playground bundle asset removed (ready; ADR-0249).
- `npm-client/eddy-batch-asset-closure` — opt-in accelerator: one batch
  closure for the exact missing applied set, learned-pin fast path, STD fallback
  (ready; blocked by the store).
- `npm-client/esbuild-alias-override-retirement` — kill the dead ~20MB alias
  download by selecting and recording the synthetic public package directly;
  entry gate = the real-Vite e2e measurement (draft; blocked by the store).
- `npm-client/sass-embedded-substitution` — chooses an honest pure-JS twin or a
  derived runtime adapter against the real Sass API; only the latter exercises
  the declared-asset delivery plane (draft).
- `process-meta/shadow-capsule-selective-ci` — full-input-digest selection for
  expensive capsule proof (draft; promote when a named second derived-runtime
  capsule is ready).
- `npm-client/external-shadow-registries` — substitution data and runtime
  adapters become distinct public-API values for embedders (draft; ADR before
  ready; consumed by epic `embeddable-dev-loop`).
