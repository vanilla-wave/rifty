---
area: runtime-js
status: ready
title: Remove redundant no-COI recovery-tree copies
created: 2026-09-06
why: Each acknowledged edit copies all installed bytes on the page thread; SDK install and restart retain redundant snapshots.
code:
  - packages/runtime-js/src/host.ts
  - packages/rifty/src/sandbox.ts
  - packages/workbench/src/workers/no-coi-toolchain-worker.ts
---

## Context

On baseline 59df0c0a3, host writeFile clones every recovery file after each
acknowledgement. SDK snapshots again after install and after restore; same-OPFS
restore posts files the Worker ignores. Worker snapshotFiles copies mirror bytes
immediately before structured clone copies them. ADR-0377 D2 owns recovery.
Handoff measurements (~18k files/66 MB, Node 24/M3 Pro) estimated 15–18 ms and
63 MiB allocated per edit; these are prior-session observations, not a portable
latency guarantee. This unit removes that byte work, not total Vite boot cost.

Dedup: 2026-09-06 titles/code/epic links and ADR index declined concepts contain
no matching recovery-copy unit; journal/crash-consistency declines do not apply.

## User scenario

A no-COI SDK user installs Vite 7.3.6, starts it, edits source through
sandbox.fs.writeFile and explicitly restarts. An edit must not copy untouched
installed bytes; same-OPFS restart need not transmit the installed tree. Memory
restart and backend changes still recover exact acknowledged bytes without npm.

## Acceptance

1. An acknowledged public write copies only its input bytes, never untouched
   recovery bytes; existing paths and new root-relative paths survive. → scenario
2. SDK install holds no redundant recovery snapshot; restart snapshots the old
   controller once, retaining recovery through failed replacement attempts. → scenario
3. Same-OPFS restore sends no recovery files; the host keeps the full recovery
   state, and both backend-flip directions and memory→memory send all files. → ADR-0377
4. Real Chromium Vite install/edit/OPFS restart proves reduced page allocations
   and empty restore payload; existing memory restart/HMR proof stays green. → scenario
5. Worker install relies on message structured clone for byte ownership;
   recovery path scope and exact bytes remain unchanged. → ADR-0377

Evidence: `reference/no-coi-recovery-copy-evidence.md` (baseline runs + versions).

## Parity cases

1. Baseline restart/file semantics are ADR-0377 D2, not a new Node API:
   host snapshots remain detached from callers and restore inputs; existing
   root-relative alias and memory Vite restart cases remain green. → ADR-0377

## Fault matrix

Boundary: dedicated Worker/MessagePort, exactly-once ordered delivery while
alive. Transport duplicate/reorder/partial-delivery physically excluded.
Existing operation slot/death settlement remain authorities; no new mechanism.

| Axis × operation | Honest outcome / carrier |
|---|---|
| torn-state / quota-perm-fail × public write | Rejection or peer death leaves prior acknowledged bytes; pending input mutation cannot alter recovery. Host fault test. → ADR-0377 |
| concurrent-same-key × write acknowledgements | Two ordered successful acknowledgements retain the latest bytes. Host fault test. → ADR-0377 |
| corrupt-input / poisoned-cache × snapshot/restore | Caller-mutated input or returned typed arrays cannot mutate retained recovery; invalid restore stays loud. Host fault test. → ADR-0377 |
| provenance-lie / false-fallback × restore | Empty OPFS wire payload never replaces full host recovery; failed replacement retains prior recovery; a later memory Worker receives bytes. Host/backend matrix + SDK restart suite. → ADR-0377 |

Other axes: no stream/retry/cache identity/aggregate or new external oracle is
introduced; existing exact validators, finite operation slot, flush and Worker
terminal carriers remain. Sibling sweep: host install/write/snapshot/restore,
SDK install/restart, Worker snapshot/restore; COI owner snapshots have separate
VFS ownership and are unchanged.

## Out of scope

Changing recovery scope (cwd/cache exclusions), durability guarantees, and
memory-only capture. Public detached snapshots still copy bytes at their trust
boundary: frozen objects cannot make Uint8Array elements immutable. No new
capability, silent fallback, or compatibility claim.

## Decisions

review: checkpoints rounds:2
- 2026-09-06 — pickup band 3–4 rounds 2; standalone unit, BASE 59df0c0a3.
- 2026-09-06 — DEC-1 reversible: preserve ADR-0377 scope/ownership; remove redundant work, retain detached boundary copies.
- 2026-09-06 — user authorized autonomous implementation and green PR; no unresolved observable forks.

## Challenge

challenge: 2026-09-06 — clear
