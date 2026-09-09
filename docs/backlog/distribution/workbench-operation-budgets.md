---
area: distribution
status: ready
title: Configure effective Workbench boot and project-operation wait budgets
created: 2026-09-07
why: Hidden owner-ready, storage-proof, file-commit and tool deadlines can defeat a host-selected budget.
user_story: As the Tracker plugin-sandbox embedder, I want to configure effective workbench boot and project-operation wait budgets, but today hidden owner-ready, storage-proof, file-commit and tool deadlines can defeat a host-selected budget.
epic: self-hosted-snapshot-workbench
blocked_by: []
sources: [docs/backlog/epics/self-hosted-snapshot-workbench/goal.md, docs/backlog/distribution/reference/embedder-gaps-evidence.md, docs/backlog/distribution/reference/workbench-operation-budgets-evidence.md, ADR-0408, ADR-0360]
code: [packages/workbench/src/workbench/workbench-owner-port.ts, packages/workbench/src/workers/workbench-owner-storage.ts, packages/workbench/src/workers/workbench-owner-runtime.ts, packages/workbench/src/workbench/workbench-browser-owner.ts, packages/workbench/src/workbench/internal/playground-session-tools-transport.ts, packages/workbench/src/workbench/internal/workbench-options.ts, tests/integration/workbench-packed-host-scenario.ts]
---

## Context

Owner operation silence and preview probe already have public settings.
Hidden total-duration siblings remain: owner ready/close/exit and OPFS
proof (30 s), project-file commit (60 s), session-tools SCM/archive/
durability-flush (60 s). Evidence:
`reference/workbench-operation-budgets-evidence.md`. Packed-host
composition of the whole scenario including installed-tarball
produce/restore is this unit's closing acceptance.

## User scenario

The embedder sets `deployment.ownerStartupTimeoutMs`,
`projectFileTimeoutMs`, and `sessionToolsTimeoutMs` to values larger
than today's hidden 30 s / 60 s defaults. Owner ready, OPFS proof, and
owner close/exit wait the public startup budget; a project-file commit
waits the public file budget; Playground SCM/archive/flush requests wait
the public session-tools budget. A shorter hidden sibling does not fire
first. Omitted options keep today's defaults. Invalid numbers fail
before owner start. A timeout still does not claim an admitted mutation
did not apply. After sibling capabilities, a packed host produces a
Vite snapshot from the installed `@riftydev/workbench/dep-snapshot`
tarball and restores it snapshot-only under `/sandbox/` with prefix,
namespace, orphan retain, and those budgets.

## Acceptance

1. Omitted `deployment.ownerStartupTimeoutMs` / `projectFileTimeoutMs` / `sessionToolsTimeoutMs` keep today's 30 000 ms owner ready/close/exit and OPFS proof, and 60 000 ms VFS commit and session-tools request budgets. `workbench-operation-budgets.contract.test.ts` omitted case; existing owner-port hung-ready and browser-owner silence/commit defaults stay. → I7 → ADR-0408
2. The three positive options are valid Workbench admission and appear on `owner.start` input (absent when omitted, like silence). Same contract file admission case. → I7 → ADR-0408
3. Invalid values (`0`, `-1`, `Infinity`, `NaN`, `'80'`) throw `TypeError` naming `deployment.<option>` before owner start / SW register. `workbench-operation-budgets.fault.test.ts`. → I7 → ADR-0408
4. `ownerStartupTimeoutMs: 80` rejects a hung owner-ready (and hung close/exit observe) at 80 ms, not 30 000 ms; `ownerStartupTimeoutMs: 60_000` is still pending at 30 000 ms. Same contract file plus owner-port delayed-boundary cases. → I7 → scenario → ADR-0408
5. The same public startup budget is the OPFS proof timeout: owner initialize admits `deployment.ownerStartupTimeoutMs` and `runWorkbenchOwner` passes that number as `proofTimeoutMs` into `installWorkbenchOwnerStorageAuthority`. `workbench-operation-budgets.contract.test.ts` initialize case plus `workbench-owner-startup-budget.contract.test.ts` runtime install seam. → I7 → ADR-0408
6. `projectFileTimeoutMs: 80` is the VFS commit budget `startBrowserWorkspaceOwner` uses; a hung commit rejects at 80 ms. `projectFileTimeoutMs: 120_000` is still pending at 60 000 ms. `workbench-browser-owner.test.ts` file-budget cases. → I7 → scenario → ADR-0408
7. `sessionToolsTimeoutMs: 80` is the session-tools request budget the browser owner passes; a hung SCM/archive request rejects at 80 ms. `sessionToolsTimeoutMs: 120_000` is still pending at 60 000 ms. Same browser-owner file tools-budget cases. → I7 → scenario → ADR-0408
8. A duration timeout still kills/rejects without claiming the admitted mutation did not apply (applied/unknown/death stay; no hidden retry). Existing owner-port hung-ready terminate case plus the short-budget reject messages. → I7 → scenario
9. Packed host from an installed workbench tarball: CI calls `produceDepSnapshot` from `@riftydev/workbench/dep-snapshot`, copies `dist/runtime/`, opens under `/sandbox/` with snapshot-only, `storage.namespace`, `previewPrefix: '/sandbox/preview'`, and the public budgets; Chromium edits/builds the real Vite project and preview/HMR resolve under that prefix; planted orphan Scratch remains downloadable. `tests/integration/workbench-packed-host-scenario.contract.test.ts` (`produceFromInstalledWorkbenchTarball` + `provePackedHostOrphanRetain`) plus packed-consumer Chromium lane. → I7 → I1 → scenario

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| corrupt-input × invalid duration | `TypeError` naming `deployment.<option>` before owner start | `workbench-operation-budgets.fault.test.ts` | → I7 → ADR-0408 |
| sibling-drift × raised startup | ready, close/exit, and OPFS proof share the one public ms | contract file startup + owner-runtime install seam | → I7 → ADR-0408 |
| sibling-drift × raised file or tools | commit / session-tools request use the public ms, not 60 000 | `workbench-browser-owner.test.ts` file/tools raise cases | → I7 → ADR-0408 |
| unbounded-read × hung ready/proof/commit/tools | reject at the public budget; no hang | contract file delayed-boundary cases | → I7 |
| provenance-lie × duration timeout | timeout does not claim not-applied; peer death/unknown stay | owner-port hung-ready terminate + short-budget reject | → I7 → scenario |

## Out of scope

Changing ADR-0360 silence semantics or `previewProbeTimeoutMs`. Changing
TypeScript `tsRequestTimeoutMs` or snapshot byte caps. Guest execution
limits. A new timeout/retry coordinator. Multiple concurrent Workbench
owners. Hostile-code isolation.

## Decisions

- 2026-09-09 — Acc 9 FIX: produce imports `./dep-snapshot` from a packed workbench tarball (not a file-URL re-export); packed consumer serves the document under `/sandbox/`, restores a produced Vite snapshot snapshot-only, and downloads a planted orphan on that host.
- 2026-09-09 — ready-verdict: Contract+RED PASS @ 6df8f51ed2cde6d17d5e9bab278ea53d27ca3e05
- 2026-09-09 — Contract+RED reception: Acc 5 drives `runWorkbenchOwner` initialize→install (`proofTimeoutMs`) and races inspect-reject against the installer call (owner loop does not settle); Acc 9 replaces fixture token-grep with executed produce/orphan carriers. Trace: I7, I1 packed residual, scenario step 7.
- 2026-09-09 — ADR-0408: three optional duration budgets; omitted keeps 30 s/60 s owners; silence stays ADR-0360; catalog owner RPCs stay silence; no new coordinator.
- 2026-09-07 — finding draft; observable scope is settled by goal I7; carrier choices and Contract+RED remain at pickup.
- 2026-09-07 — inherit the goal's production fault tier for this boundary; use docs/process/rules/fault-classes.md and existing owners before adding coordination.

## Challenge

challenge: 2026-09-09 — clear
