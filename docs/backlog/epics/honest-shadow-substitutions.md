---
kind: epic
status: in-progress
title: Honest builtin shadow runtime delivery
created: 2026-07-13
value: Vite 7 installs and executes npm-proven esbuild bytes without host WASM or a redundant alias payload, with storage-qualified readiness and measured STD/Eddy cost
user_story: As a browser-IDE user with a Vite project, I want cold install to fetch and execute esbuild's exact runtime bytes once with npm-grade provenance, but today it downloads an unused alias while the executed WASM arrives outside npm as an app-bundle asset
items: [distribution/workbench-runtime-asset-cutover, npm-client/esbuild-alias-override-retirement, distribution/workbench-runtime-asset-cold-bench, npm-client/eddy-batch-asset-closure]
---

## Outcome

Asset delivery is declared data; runtime adaptation stays explicit,
package-specific, parity-proven code. Applied substitutions yield one exact
asset set. An owner-resident `ShadowAssetManager` produces a storage-qualified
readiness receipt at the package-acquisition seam and serves verified bytes
through ADR-0266's URL-entry capability (ADR-0249). Receipts distinguish
`opfs-persisted`, `opfs-best-effort`, and `memory-session`; the latter two make
no stronger reload claim.

The applied-substitution record is installer-neutral value data. npm-client is
the sole v0 producer; resolver nodes, placements, redirect targets, and lockfile
parser objects never enter the plan. A future native package-manager direction
may replace the installer-side producer/composition after its own recorded
decision and must prove what was actually applied. The plan/receipt,
manager/store, owner readiness/epoch/admission, and child runtime reader stay
unchanged. This epic adds no hypothetical producer SPI.

Executed bytes gain npm provenance, esbuild WASM leaves deployment config, and
delegate materialization removes the unused `@esbuild/wasi-preview1` alias
payload from cold install. Opt-in Eddy batches only the missing applied set and
is measured against the same committed STD cold boundary.

This outcome proves one builtin production consumer: esbuild for Vite 7.
Additional popular package substitutions belong to the separate draft
`popular-packages-shadow-registry` epic. Selective capsule CI and external
construction interfaces remain explicit follow-ups.

Mission anchor: real Node software gets the real tool bytes and runtime behavior
the user can audit.

## User scenario

A generic Workbench user opens explicit Vite 7.3.6. Cold STD open shows exact
asset phases and returns only after the 13,918,738-byte esbuild member has a
ready receipt. A Playground companion cold project instead preserves ADR-0278:
open returns the default terminal, and first `session.run()` visibly executes
`$ npm install` plus the same asset phases before Vite starts. Trusted existing
or valid snapshot paths are ready before project-opened.

The same real-browser before/after network proof records the exact response-body
bytes removed and observes no `@esbuild/wasi-preview1` alias tarball request.
The installed `esbuild` delegate retains exact
lockfile/substitution provenance and the Vite dev/build/preview/optimize
journeys remain parity-green. A latency saving is claimed only if both runs use
the same end-to-end boundary, cache regime, origins, and transport.

Persistent OPFS survives HTTP-cache eviction/reload while origin data remains;
best-effort OPFS says only that, and memory is session-only. Post-tree asset
failure exits nonzero while exact tree finalization and v4 promotion remain
independent; no runtime runs stale or missing bytes. Default Vite 8 produces the
canonical empty plan and no esbuild fetch, capability, or progress.

An app update that changes the esbuild pin produces a new receipt without
invalidating dependency-tree identity. Cold STD pays one serial
13,918,738-byte-member fill after the tree. Its wall time and response bytes are
measured from the first `cache-check` through acknowledged `ready` inside the
generic Workbench `openProject`; this is an asset-fill component, not full
install/open/Vite readiness. Eddy adds one matched row without changing that
boundary. Alias retirement has the separate matched whole-journey proof above.

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
                                                 retire alias download
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
alias retirement use the final extracted composition; the committed benchmark
runs only after both user-visible delivery changes land.

The proposed real Node-server dev-loop substrate may proceed in runtime-js and
kernel, but its final Workbench integration follows this epic's cutover and
targets extracted `packages/workbench` paths. A recursive child that needs a
non-empty asset plan requires a fresh owner-admitted capability; automatic
inheritance or a host-esbuild fallback remains forbidden.

## Items

- `distribution/workbench-runtime-asset-cutover` — extracted Workbench joins
  the verified reader, removes host esbuild delivery, and atomically advances
  all Node entries to v2 (ready; blocked by acquisition and Workbench
  controllers).
- `npm-client/esbuild-alias-override-retirement` — remove the exact measured
  alias response bytes while retaining an exact delegate and honest lockfile
  provenance (ready; blocked by cutover; ADR-0298 fixes synthesis, marker,
  replay, provenance, and the matched fixed-origin measurement; the epic cannot
  close before it lands).
- `distribution/workbench-runtime-asset-cold-bench` — committed real-Chromium
  STD cold-fill proof over the final public Workbench composition (ready;
  blocked by cutover; runs after alias retirement in this epic's delivery
  order).
- `npm-client/eddy-batch-asset-closure` — opt-in exact-missing-set accelerator,
  STD fallback, and matched benchmark row (ready; blocked by the STD cold
  benchmark and manager).

## Downstream and contingent follow-ups

These drafts are not epic items and their outcomes are not promised here:

- `epics/popular-packages-shadow-registry` — separate draft user-value epic for
  Sass and later named popular native-backed packages; each adapter remains
  package-specific and parity-proven.
- `process-meta/shadow-capsule-selective-ci` — becomes actionable only with a
  named second derived-runtime capsule.
- `npm-client/external-shadow-registries` — separate public catalog and trusted
  runtime-adapter decisions.
- `perf/redundant-v4-eddy-prefetch` — optional measured removal of bounded warm
  speculative work; never a reason to add synchronous SHA or weaken v4 trust.
- `distribution/workbench-recursive-runtime-asset-admission` — owner-brokered
  fresh capability for recursive children with a non-empty asset plan.
- `distribution/workbench-runtime-asset-retention-gc` — measured retention/GC
  and quota recovery without evicting a live or ready set.
- `playground/runtime-asset-cache-recovery-ui` — first-party status and
  recovery controls over the public inspect/clear/error contract.

## Accepted platform boundaries

- Full non-Chromium support is outside the Chrome-first mission. Honest
  capability reporting remains owned by
  `playground/capabilities-detection-e2e-logging` and
  `service-worker/cross-browser-compat-matrix`; this epic adds no browser claim.
- Workbench v0 intentionally permits one origin-wide Workbench and one active
  project through ADR-0263's Web Lock. Broader tab discovery/read-only/takeover
  remains in `playground/multi-tab-undefined-behavior`; runtime assets do not
  create a second multi-Workbench policy item.
