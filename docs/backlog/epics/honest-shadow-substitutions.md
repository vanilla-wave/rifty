---
kind: epic
status: ready
title: Honest shadow substitutions at scale
created: 2026-07-13
value: Substituted native packages install real integrity-pinned runtime bytes through the npm pipeline, with storage-qualified readiness and an optional measured Eddy accelerator
user_story: As a browser-IDE user with a vite project, I want install to deliver every substituted package's executed bytes with npm-grade provenance, but today esbuild's wasm arrives outside npm as an app-bundle asset
items: [npm-client/shadow-asset-catalog-plan, npm-client/shadow-asset-manager, npm-client/shadow-asset-message-port, kernel/worker-capability-ports, distribution/workbench-install-stamp-v4, distribution/workbench-runtime-asset-storage, distribution/workbench-runtime-asset-acquisition, distribution/workbench-runtime-asset-cutover, distribution/workbench-runtime-asset-cold-bench, npm-client/eddy-batch-asset-closure]
---

## Outcome

Asset delivery is declared data; runtime adaptation stays explicit,
package-specific, parity-proven code. Applied substitutions yield one exact
asset set. An owner-resident `ShadowAssetManager` produces a storage-qualified
readiness receipt at the package-acquisition seam and serves verified bytes
through ADR-0266's URL-entry capability (ADR-0249). Receipts distinguish
`opfs-persisted`, `opfs-best-effort`, and `memory-session`; the latter two make
no stronger reload claim.

Executed bytes gain npm provenance and esbuild WASM leaves deployment config.
Opt-in Eddy batches only the missing applied set and is measured against the
same committed STD cold boundary. The core outcome does not promise removal of
the current alias download, a second substituted package, selective capsule CI,
or external construction interfaces; those remain explicit draft follow-ups.

Mission anchor: real Node software gets the real tool bytes and runtime behavior
the user can audit.

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
invalidating dependency-tree identity. Cold STD pays one serial
13,918,738-byte-member fill after the tree. Wall time and response bytes are
measured at the generic Workbench `openProject` boundary; Eddy adds one matched
row rather than changing the benchmark boundary.

## Delivery graph

~~~text
catalog/plan -> manager -> MessagePort ------------------+
                      \-> private storage/admin ---------+
v4 install stamp ----------------------------------------+--> acquisition +
kernel URL-entry capabilities ---------------------------+    child admission
                                                               |
                                                               v
                                                 Workbench controller
                                                 extraction
                                                               |
                                                               v
                                                 deployment cutover +
                                                 node-entry/v2
                                                               |
                                                               v
                                                        cold STD bench
                                                               |
                                                               v
                                                              Eddy
~~~

Catalog, manager, MessagePort, v4, kernel, storage, and acquisition have
independent RED/GREEN closure. Storage and acquisition may land on the current
app-local Workbench through its existing interfaces. Acquisition explicitly
blocks controller extraction, which then moves landed semantics without
creating a second facade, protocol, VFS, or state owner. Deployment cutover and
the committed benchmark use the final extracted composition.

The proposed real Node-server dev-loop substrate may proceed in runtime-js and
kernel, but its final Workbench integration follows this epic's cutover and
targets extracted `packages/workbench` paths. A recursive child that needs a
non-empty asset plan requires a fresh owner-admitted capability; automatic
inheritance or a host-esbuild fallback remains forbidden.

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
- `distribution/workbench-install-stamp-v4` — exact lockfile-byte claim,
  package-only demotion, async trust, and conservative sync prefetch result
  (ready; unblocked).
- `distribution/workbench-runtime-asset-storage` — app-local owner-private
  semantic store, scoped durability, manager lifetime, and public inspect/clear
  recovery (ready; blocked by manager).
- `distribution/workbench-runtime-asset-acquisition` — one package-FIFO
  readiness authority for generic/companion timing, mutation epochs, post-tree
  failure, and exact-plan child admission (ready; blocked by v4, storage,
  MessagePort, and kernel capabilities).
- `distribution/workbench-runtime-asset-cutover` — extracted Workbench joins
  the verified reader, removes host esbuild delivery, and atomically advances
  all Node entries to v2 (ready; blocked by acquisition and Workbench
  controllers).
- `distribution/workbench-runtime-asset-cold-bench` — committed real-Chromium
  STD cold-fill proof over the final public Workbench composition (ready;
  blocked by cutover).
- `npm-client/eddy-batch-asset-closure` — opt-in exact-missing-set accelerator,
  STD fallback, and matched benchmark row (ready; blocked by the STD cold
  benchmark and manager).

## Contingent follow-ups

These drafts are not core epic items and their outcomes are not promised here:

- `npm-client/esbuild-alias-override-retirement` — the approximately 20 MB
  download saving is contingent on its real-Vite measurement and provenance
  ADR.
- `npm-client/sass-embedded-substitution` — choose and parity-prove a second
  runtime pattern before reusing the delivery plane.
- `process-meta/shadow-capsule-selective-ci` — becomes actionable only with a
  named second derived-runtime capsule.
- `npm-client/external-shadow-registries` — separate public catalog and trusted
  runtime-adapter decisions.
- `perf/redundant-v4-eddy-prefetch` — optional measured removal of bounded warm
  speculative work; never a reason to add synchronous SHA or weaken v4 trust.
