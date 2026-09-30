---
area: distribution
status: ready
title: Observe SDK boot and snapshot progress with discriminable failures
created: 2026-09-27
why: pre-ready contention is invisible and lost behind the startup deadline; hosts cannot identify retryable outcomes or display real snapshot counts
epic: no-coi-agent-host-kit
sources: [ADR-0413, ADR-0417, ADR-0419, ADR-0420, ADR-0428, ADR-0486]
code: [packages/rifty/src/sandbox.ts, packages/runtime-js/src/host.ts, packages/runtime-js/src/worker-entry.ts, packages/vfs/src/opfs-replica-store.ts, packages/workbench/src/workers/no-coi-snapshot-application.ts]
---

## Context

Combined former typed-outcomes/progress items: I1 needs both pre-ready native
observation and a structural discriminator. ADR-0486 fixes the additive carrier;
existing timers, admission, conflicts and force semantics remain authoritative.

## User scenario

The host subscribes before awaiting createSandbox, renders real phases/counts,
and distinguishes busy/occupied/conflict/mismatch/restart/persistence outcomes
without guessing from messages. After the holder closes, the second opener can
retry against the actual OPFS store.

## Acceptance

1. SDK root exports SandboxOpening and sandboxErrorKind/SandboxErrorKind;
   existing awaited readiness and asynchronous rejection remain. Early runtime.on
   subscriptions survive resolution/restart and detach normally. → I2/I3
2. Real boot reports worker-spawned, storage-admitted, toolchain-ready; contention
   reports waiting-for-storage-writer before resolution. → I1/I3
3. Either existing deadline yields occupied with native contention cause; guard
   expiry retains OpfsPreloadError, no memory fallback. Release permits retry.
   Permission/import/unobserved timeout and post-admission hydration failure are
   not occupied. → I1
4. Actual run/fs/install overlap, resident admission, restart overlap, snapshot
   conflicts, identity/template/runtime mismatches and persistence failures are
   discriminable. Unknown/network/parse errors remain unknown; README retry table
   names safe conditions. → I2
5. Snapshot events identify their existing operation and show actual fetched
   bytes/declared same-domain total, changed payload entries/total, native cache
   and payload flush counts. Missing totals stay absent; no fabricated completion
   after failure, no replay of settled or replaced-worker operations. → I3
6. Same bytes remain allowed; force still replaces conflicting targets only,
   preserving unrelated files. Existing snapshot proof retained. → I2/ADR-0420

## Fault matrix

| Axis × operation | Honest outcome | Proof |
| --- | --- | --- |
| provenance-lie × boot deadline | occupied only after native contention and before admission | two native Workers, both deadlines, negative controls → I1 |
| lossy-aggregate × Worker error | retain discriminator/native cause across boundary | actual browser failures → I1/I2 |
| sibling-drift × live/restarted subscription | one event hub, detach respected | early subscribe/restart → I3 |
| provenance-lie × snapshot counts | real byte/write/flush domains, absent unknown totals | real producer, HTTP declared/chunked/encoded, native replica → I3 |
| sibling-drift × Worker replacement | abandoned operation cannot update replacement | native held fetch/restart; same-peer transport reorder physically excluded → I3 |
| provenance-lie × failed persistence | never report failed native writes persisted | native quota fixture → I2/I3 |

## Challenge

challenge: 2026-09-30 — clear; accepted I1–I3 premise reused. Independent design
review chose the Promise subscription over early readiness/new callback; existing
snapshot decision rules out blanket nonempty conflicts. No new coordination;
reuse runtime peer and request maps (ADR-0486).

## Out of scope

- New SDK queue, timer, retry, lease, applied-snapshot identity or migration.
- Whole-open percentages; workbench health-progress changes.
- Agent registry connection/no-registry outcome: linked I9.

## Decisions

ready-verdict: 2026-09-30 — Contract+RED @ 1024adea2133a39684462bdf571e1234870dfb69

- 2026-09-30 — ADR-0486; former map items 1–2 combined, destination unchanged.

- 2026-09-30 — fault model corrected against rules/fault-classes.md Worker row: native transport reorder is physically excluded. I3/Acceptance5 unchanged; real held-fetch/restart is the failure carrier.
