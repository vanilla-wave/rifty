---
area: perf
subsystem: toolchain-build
status: ready
title: Child fs perf real product-COI owner-to-kernel-child lane
created: 2026-08-26
epic: child-fs-rpc-hot-path
why: the benchmark needs raw Vite and Express samples from the actual playground owner fs served to a supervised child
user_story: As the child-fs measurement rig, I want both anchors executed through the real COI owner→kernel child topology, but today only a throwaway spike drives it.
sources: [perf/child-fs-perf-lane split @ fb02b2c2f, ADR-0150, ADR-0196, browser-unit owner-node-stdio-control]
code: [tests/browser-unit/fixtures/child-fs-product-lane.ts, tests/browser-unit/child-fs-product-lane.spec.ts, tests/browser-unit/child-fs-product-lane.fault.spec.ts]
---

## User scenario

On the real browser-unit COI page, pass a recording decorator over the sealed
Workbench fixture into `runChildFsProductLane`. It opens the canonical plan,
installs exact dependencies, then runs `vite build` and
`node express-anchor.cjs <run-marker>` through the public terminal. The test
independently observes every real host call/result, owner file read and close;
the returned raw sample must also pass the shared artifact verifier.

## Acceptance

- The runner rejects a non-COI host before opening. On the real COI host it
  passes one plan whose files/dependencies equal `childFsScenario()`, executes
  real `npm install`, and reads every direct dependency's installed package.json
  version back from the owner project.
- The host-call trace proves the organic order: open → install → marker write →
  Vite terminal run → emitted-asset readdir/read → Express terminal run → close.
  The returned lifecycle values equal the independently recorded real terminal
  outcomes; each outcome has one settlement, shared close, equal exit/close tuple
  and exit 0. ADR-0150 plus the existing physical browser baselines establish
  that each terminal Node/bin run is a supervised owner-sync-FS child.
- The returned sample has product lane/topology/ordinal/idle-owner identity,
  reports exactly 2180 Vite modules, and passes `validateChildFsRawSample` — one
  positive self-time, unique emitted marker, then one positive matching Express
  READY before CLOSED.
- The runner settles only after the emitted JS read and Express close. A single
  `finally` calls host close after any post-open success or failure; a real-open
  injected command failure proves rejection and released sealed ownership.

## Parity cases

- `product-vite-2180`: exact canonical owner tree/install + public terminal →
  exit 0, exactly 2180 modules, positive self-time, one fresh emitted marker.
- `product-express-cold`: a later public terminal call of canonical source →
  exit 0, positive matching READY before CLOSED.
- `organic-order`: independently recorded sealed-Workbench calls/results equal
  the runner result and place asset read/command settlement before final close.

## Fault matrix

| Boundary / axis | Required outcome | RED target |
|---|---|---|
| host command `provenance-lie` / failure | a real-open injected install rejection produces no result and calls close once | fault-labelled real sealed-host decorator |
| result `corrupt-input` / `lossy-aggregate` | wrong exit/count/time/marker/order cannot become a sample | shared raw-sample verifier + exact 2180 assertion |
| realm `provenance-lie` | `coi:false` rejects before host open | fault-labelled host snapshot |

Inherited registry/Worker/terminal deadlines and physical-death behavior stay at
their existing Workbench/kernel fault suites; this fixture adds no boundary or
weaker fallback.

## Out of scope

- In-realm Worker execution, two-lane aggregation, artifact publication, and
  orchestration deadlines.
- A new child identity/debug API; the organic public terminal path + ADR-0150
  and its browser baselines are the topology authority.
- Loaded-owner stress and performance thresholds.

## Decisions

- 2026-08-26 — Contract+RED attempt 1 @ 1730d0573 blocked: opaque fixture
  self-attested COI/seed/install/topology/output/cleanup and mis-owned registry
  fault. Re-cut to a caller-supplied recording decorator over the real sealed
  Workbench plus shared raw verifier.
- 2026-08-26 — the runner owns only orchestration over an injected host seam;
  tests wrap the real sibling fixture rather than mock it. Existing Workbench
  suites remain authority for registry/Worker internals.
- 2026-08-26 — expected RED: browser-unit product spec + fault spec both fail
  because `fixtures/child-fs-product-lane.ts` does not exist.
- 2026-08-26 — Contract+RED verify @ 20ca80cbc blocked: projected execute trace
  allowed asset-read-after-Express and duplicate success close; exact phase
  indices and close cardinality added.
