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
code: [tests/browser-unit/fixtures/child-fs-product-lane.ts, tests/browser-unit/child-fs-product-lane.spec.ts]
---

## User scenario

Open the real sealed Workbench on the browser-unit COI page with the canonical
child-fs scenario. Install its exact dependencies, then run `vite build` and
`node express-anchor.cjs <run-marker>` through the public project terminal. Both
commands execute as supervised children reading the owner store through ADR-0150
sync-FS; return their raw output and emitted JS for the shared artifact verifier.

## Acceptance

- The lane runs only when `crossOriginIsolated === true`, seeds exactly
  `childFsScenario()`, performs the real install, and returns the canonical
  scenario/dependency identity with lane `product-coi`, topology
  `owner-sync-rpc-kernel-child`, ordinal, and owner-load `idle`.
- Vite runs through the public Workbench terminal. Its physical lifecycle
  settles exactly once; exited/close outcomes are identical exit 0; raw output
  reports exactly 2180 transformed modules and one self-time; emitted JS contains
  the unique run marker exactly once.
- Express runs in a fresh subsequent child. Its physical lifecycle settles
  exactly once; exited/close outcomes are identical exit 0; raw output contains
  exactly one matching READY and CLOSED line from the canonical clock-before-
  require source.
- The function returns no sample until both commands and emitted-asset read pass.
  Success and every failure path close terminal/project/Workbench ownership.

## Parity cases

- `product-vite-2180`: canonical bytes and exact dependency versions → exit 0,
  one `2180 modules transformed`, one `built in`, one emitted marker.
- `product-express-cold`: canonical source → exit 0, one positive READY duration
  followed by one CLOSED marker; command uses a fresh physical child after Vite.
- `physical-settlement`: each command exposes one exited settlement, shared
  close promise, and byte-identical exited/close tuple through the public
  Workbench terminal (ADR-0150/physical browser-unit baseline).

## Fault matrix

| Boundary / axis | Required outcome | RED target |
|---|---|---|
| registry `unbounded-read` / failure | Workbench install rejects within its shipped bound; no sample; fixture closes | aborted real `/npm-registry` request + subsequent reopen |
| child `provenance-lie` / death | nonzero/signal or mismatched settlement rejects; no sample | physical lifecycle assertions + existing real-worker/stdio browser suites |
| owner/result `corrupt-input` / `lossy-aggregate` | wrong count/marker/output cannot become a sample | exact product assertions then shared artifact verifier suite |

## Out of scope

- In-realm Worker execution, two-lane aggregation, artifact publication, and
  orchestration deadlines.
- Loaded-owner stress and performance thresholds.
- New Workbench or runtime public API; this is a test fixture over existing
  public project/terminal/files handles.

## Decisions

- 2026-08-26 — public sealed Workbench fixture is the organic product path;
  direct kernel spawn would bypass owner/project behavior and cannot close I3.
- 2026-08-26 — physical topology is inherited from ADR-0150 and already proven
  by browser-unit real-worker + owner-node-stdio-control suites; this slice adds
  the exact Vite/Express scenario and settlement proof, not a second worker hook.
- 2026-08-26 — expected RED: `pnpm exec playwright test --config
  playwright.browser-unit.config.ts tests/browser-unit/child-fs-product-lane.spec.ts`
  → 2 tests fail because `fixtures/child-fs-product-lane.ts` does not exist.
