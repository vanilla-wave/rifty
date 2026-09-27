---
area: distribution
status: draft
title: Deliver boot phases and snapshot-application counts through sandbox.runtime.on
created: 2026-09-27
why: the SDK emits no phase or count during a multi-second boot or a snapshot application, so hosts render a stopwatch capped at 95% with invented phase names
epic: no-coi-agent-host-kit
sources: [ADR-0413, ADR-0419, ADR-0420, ADR-0428, docs/adr/README.md, docs/backlog/distribution/reference/no-coi-agent-host-kit-evidence.md]
code: [packages/runtime-js/src/host.ts, packages/runtime-js/src/worker-entry.ts, packages/workbench/src/workers/no-coi-snapshot-application.ts, packages/workbench/src/glue/dep-snapshot.ts, packages/vfs/src/opfs-replica-store.ts]
---

## Context

Finding. `RuntimeEvent` (`packages/runtime-js/src/host.ts:62-70`) is
`ready | stdout | stderr | result | exit | diagnostic`; `toolchainReady` is an
internal promise (`host.ts:117`). Snapshot application
(`no-coi-snapshot-application.ts`) fetches, verifies, prepares, applies and
flushes with no observable step. The second-opener wait (ADR-0428, 25 ms
retries up to 30 s) is invisible to the page. Issue #345 reports apply ≈ 16 s
vs open ≈ 1 s on the host side (host measurement, not reproduced in-repo).

Goal obligations: I3 (boot phases worker spawned → storage admitted →
toolchain ready; apply counts fetched bytes / declared total, entries
written / total, flush persisted / total; real counts of one operation, never
a whole-open percent; no separate callback) and I1's "waiting for storage
writer" phase. Declined row (`docs/adr/README.md:630`): a separate
`onLifecycle` subscription duplicates `runtime.on` — phases ride the existing
event channel. ADR-0413 fixes the honesty rule for counts.

## Out of scope

- Percent-of-whole or time estimates; totals the source does not declare are
  reported as absent.
- Workbench health progress (ADR-0413) — unchanged.

## Decisions

- carrier (new `RuntimeEvent` kinds vs one `progress` kind with a phase/count
  payload; exhaustive-switch compatibility for existing consumers) at pickup;
  public event union → ADR at pickup.
