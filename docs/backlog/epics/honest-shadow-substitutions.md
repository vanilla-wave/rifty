---
kind: epic
status: ready
title: Honest shadow substitutions at scale
created: 2026-07-13
value: Substituted native packages install real, integrity-pinned runtime bytes through the npm pipeline — storage-honest, eddy-accelerated, and cheap to extend to the next package
user_story: As a browser-IDE user with a vite project, I want install to deliver every substituted package's executed bytes with npm-grade provenance, but today esbuild's wasm arrives outside npm as an app-bundle asset while install downloads ~20MB of dead alias bytes
items: [npm-client/shadow-asset-catalog-plan, npm-client/shadow-asset-manager, npm-client/shadow-asset-message-port, kernel/worker-capability-ports, distribution/workbench-runtime-assets, npm-client/eddy-batch-asset-closure, npm-client/esbuild-alias-override-retirement, npm-client/sass-embedded-substitution, process-meta/shadow-capsule-selective-ci, npm-client/external-shadow-registries]
---

## Outcome

Asset delivery is declared data; runtime adaptation stays explicit,
package-specific, parity-proven code. Applied substitutions yield an exact asset
set; one owner-resident `ShadowAssetManager` produces its readiness receipt
before install reports success and serves verified bytes through ADR-0266's
owned named Worker capability port (ADR-0249). Receipts distinguish
`opfs-persisted`, `opfs-best-effort`, and
`memory-session`; the latter two warn and make no stronger reload claim.
Executed bytes get npm provenance; the playground bundle stops carrying wasm;
the dead ~20MB alias download dies; eddy (opt-in) batches only the missing
applied set. Capsule CI keys expensive proof to the complete input closure, so
a package-local change stays local while shared runtime changes select every
affected capsule. Mission anchor: real Node software needs real tool bytes and
runtime behavior the user can audit.

## User scenario

A user opens `projects.vite({ viteVersion: '7.3.6' })` and runs `npm i` +
`npm run dev`. Install shows asset fetch/verify/persist progress and exits zero
only after the exact applied `esbuild.wasm` receipt is ready for the reported
storage class (eddy warm path:
one learned-pin GET for the missing set; cold path: size/no-progress-bounded
resolve). Persistent
OPFS survives HTTP-cache eviction and reload offline; best-effort OPFS says the
same only while origin storage remains, and memory is session-only. If asset
delivery fails after the tree is ready, npm exits nonzero with a structured
phase error; acquisition schedules independent tree promotion while shell
reports nonzero. Vite reads the already-verified 13,918,738-byte member through
the owner port — no runtime network fetch. An app
update that changes the esbuild pin produces a new receipt: install or restore
fetches exactly the new bytes or fails loud, never runs stale ones. Default
`projects.vite()` on Vite 8 produces the canonical empty plan and no esbuild
fetch, capability, or progress. A later `sass-embedded` substitution reuses
this delivery plane only if the derived
runtime pattern wins and its real API/lifecycle adapter passes parity; an honest
pure-JS twin has no declared-asset obligation. A contributor changing one capsule runs
its proof suite; a manager, owner-port, VFS, runtime, or relevant lockfile-input
change selects every affected capsule rather than silently trusting a path list.
Cold STD install pays one serial 13,918,738-byte-member fill after the tree; its
wall time and tarball-body bytes are measured in the Workbench runtime-assets
item, never inferred from the no-progress bound. Eddy adds only a matched row.

## Delivery graph

~~~text
catalog/plan -> manager -> MessagePort ----┐
                                           ├-> Workbench runtime assets
kernel capabilityPorts --------------------┤             |
Workbench controllers ---------------------┘             v
                                                    Eddy / alias
~~~

The first three items touch only shadow-registry/npm-client. Kernel starts from
the isolated bootstrap precursor, not the unfinished owner branch. Workbench
files change only after the three-way join, making the eventual rebase a path
refresh plus one adapter rather than a rewrite.

## Items

- `npm-client/shadow-asset-catalog-plan` — clone-safe builtin descriptors,
  typed applied-substitution trace, exact planner and independent tree/set
  identities (ready; unblocked).
- `npm-client/shadow-asset-manager` — path-neutral deep manager, verified
  store/publish/receipts, STD transport and structured install outcome (ready;
  blocked by catalog/plan).
- `npm-client/shadow-asset-message-port` — exact-plan async protocol over a
  real MessageChannel; bounded reads/errors/cancel/dispose, without spawn wiring
  (ready; blocked by manager).
- `kernel/worker-capability-ports` — protocol-opaque named `MessagePort`
  transfer, pre-entry publication, and failure-atomic lifecycle cleanup (ready;
  ADR-0266). Landing order waits for the active kernel/bootstrap precursor, but
  that temporary git order is not an architectural `blocked_by`.
- `distribution/workbench-runtime-assets` — one origin-private cache,
  v4 arrival hooks, public progress/admin, child capability, esbuild host-asset
  removal and real-browser cold baseline (ready; blocked by manager,
  MessagePort, kernel and Workbench controllers).
- `npm-client/eddy-batch-asset-closure` — opt-in accelerator: one batch
  closure for the exact missing applied set, learned-pin fast path, STD fallback
  (ready; blocked by manager and Workbench runtime assets).
- `npm-client/esbuild-alias-override-retirement` — kill the dead ~20MB alias
  download by selecting and recording the synthetic public package directly;
  entry gate = the real-Vite e2e measurement (draft; blocked by Workbench
  runtime assets).
- `npm-client/sass-embedded-substitution` — chooses an honest pure-JS twin or a
  derived runtime adapter against the real Sass API; only the latter exercises
  the declared-asset delivery plane (draft).
- `process-meta/shadow-capsule-selective-ci` — full-input-digest selection for
  expensive capsule proof (draft; promote when a named second derived-runtime
  capsule is ready).
- `npm-client/external-shadow-registries` — declarative catalogs and
  Worker-loadable runtime-adapter composition become separate public-interface
  decisions; host functions never cross Workbench boot IPC (draft; ADR before
  ready; consumed by epic `embeddable-dev-loop`).
