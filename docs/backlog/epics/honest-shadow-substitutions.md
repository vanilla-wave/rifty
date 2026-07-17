---
kind: epic
status: ready
title: Honest shadow substitutions at scale
created: 2026-07-13
value: Substituted native packages install real, integrity-pinned runtime bytes through the npm pipeline — storage-honest, eddy-accelerated, and cheap to extend to the next package
user_story: As a browser-IDE user with a vite project, I want install to deliver every substituted package's executed bytes with npm-grade provenance, but today esbuild's wasm arrives outside npm as an app-bundle asset while install downloads about 20MB of dead alias bytes
items: [npm-client/shadow-asset-catalog-plan, npm-client/shadow-asset-manager, npm-client/shadow-asset-message-port, kernel/worker-capability-ports, distribution/workbench-runtime-assets, npm-client/eddy-batch-asset-closure, npm-client/esbuild-alias-override-retirement, npm-client/sass-embedded-substitution, process-meta/shadow-capsule-selective-ci, npm-client/external-shadow-registries]
---

## Outcome

Asset delivery is declared data; runtime adaptation stays explicit,
package-specific, parity-proven code. Applied substitutions yield one exact
asset set. An owner-resident `ShadowAssetManager` produces a storage-qualified
readiness receipt at the package-acquisition boundary and serves verified bytes
through ADR-0266's URL-entry capability (ADR-0249). Receipts distinguish
`opfs-persisted`, `opfs-best-effort`, and `memory-session`; the latter two make
no stronger reload claim.

Executed bytes gain npm provenance; the app bundle stops carrying esbuild WASM;
the dead alias download dies; opt-in Eddy batches only the missing applied set.
Capsule CI keys expensive proof to the full input closure. Mission anchor: real
Node software gets the real tool bytes and runtime behavior the user can audit.

## User scenario

A generic Workbench user opens explicit Vite 7.3.6. Cold STD open shows exact
asset phases and returns only after the 13,918,738-byte esbuild member has a
ready receipt. A Playground companion cold project instead preserves ADR-0278:
open returns the default terminal, and first `session.run()` visibly executes
`$ npm install` plus the same asset phases before Vite starts. Trusted existing
or valid snapshot paths are ready before project-opened.

Persistent OPFS survives HTTP-cache eviction/reload while origin data remains;
best-effort OPFS says only that, and memory is session-only. Post-tree asset
failure exits nonzero while exact tree finalization and v4 promotion remain
independent; no runtime runs stale or missing bytes. Default Vite 8 produces the
canonical empty plan and no esbuild fetch, capability, or progress.

An app update that changes the esbuild pin produces a new receipt without
invalidating the dependency-tree identity. A later `sass-embedded` substitution
reuses this delivery plane only if a derived runtime wins and passes real API/
lifecycle parity. A package-local capsule change runs local proof; manager,
owner-port, VFS, runtime, or shared lockfile-input changes select every affected
capsule.

Cold STD pays one serial 13,918,738-byte-member fill after the tree. Wall time
and response bytes are measured at the generic Workbench `openProject` boundary;
Eddy adds one matched row rather than changing the benchmark boundary.

## Delivery graph

~~~text
catalog/plan -> manager -> MessagePort ----+
                                           +-> Workbench runtime assets
kernel URL-entry capabilities -------------+             |
Workbench controllers ---------------------+             v
                                                    Eddy / alias
~~~

Catalog, manager, and MessagePort touch only shadow-registry/npm-client.
Kernel work is separately implementable now that ADR-0267 is on `main`.
Workbench remains a final join blocked by controller extraction, so active
owner code is not repeatedly rebased through the lower slices.

## Items

- `npm-client/shadow-asset-catalog-plan` — clone-safe builtin descriptors,
  typed applied-substitution trace, exact planner, and independent tree/set
  identities (ready; unblocked).
- `npm-client/shadow-asset-manager` — path-neutral deep manager, verified
  store/publish/receipts, STD transport, and structured install outcome (ready;
  blocked by catalog/plan).
- `npm-client/shadow-asset-message-port` — exact-plan async protocol over a
  real `MessageChannel`; bounded reads/errors/cancel/dispose without spawn
  wiring (ready; blocked by manager).
- `kernel/worker-capability-ports` — protocol-opaque ports on URL entries,
  separate from `KernelProcessSpec` and ADR-0267 bootstrap, with
  failure-atomic lifecycle cleanup (ready; unblocked).
- `distribution/workbench-runtime-assets` — one origin-private cache, current
  Workbench state/protocol/FIFO join, v4 claims, honest generic/companion timing,
  child capability, esbuild host-asset removal, and cold STD baseline (ready;
  blocked by manager, MessagePort, kernel, and Workbench controllers).
- `npm-client/eddy-batch-asset-closure` — opt-in accelerator: one batch closure
  for the exact missing set, learned-pin fast path, STD fallback, and matched
  benchmark row (ready; blocked by manager and Workbench runtime assets).
- `npm-client/esbuild-alias-override-retirement` — remove the dead alias
  download by selecting/recording the synthetic public package directly; entry
  gate is real-Vite e2e measurement (draft; blocked by Workbench assets).
- `npm-client/sass-embedded-substitution` — choose an honest pure-JS twin or a
  derived runtime adapter against the real Sass API; only the latter uses the
  asset plane (draft).
- `process-meta/shadow-capsule-selective-ci` — full-input-digest selection for
  expensive capsule proof (draft; promote with a named second derived-runtime
  capsule).
- `npm-client/external-shadow-registries` — declarative catalogs and
  Worker-loadable adapters become separate public-interface decisions; host
  functions never cross Workbench boot IPC (draft; ADR required before ready).
