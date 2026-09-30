---
area: distribution
status: draft
title: Export typed sandbox outcomes (busy, occupied, snapshot conflict, restart-busy, persistence) from @riftydev/sdk with a retryable table
created: 2026-09-27
why: every SDK failure crosses the boundary as a bare Error whose name the host must string-match; nothing is exported, an occupied namespace is indistinguishable from other startup failures, and nothing says which outcomes are safe to retry
epic: no-coi-agent-host-kit
sources: [ADR-0376, ADR-0418, ADR-0419, ADR-0420, ADR-0425, ADR-0428, docs/backlog/distribution/reference/no-coi-agent-host-kit-evidence.md]
code: [packages/rifty/src/index.ts, packages/rifty/src/sandbox.ts, packages/rifty/src/sandbox-project.ts, packages/runtime-js/src/host.ts, packages/workbench/src/workers/no-coi-toolchain-worker.ts, packages/runtime-js/src/worker-entry.ts, packages/vfs/src/opfs-replica-store.ts]
---

## Context

Finding. `packages/rifty/src/index.ts` exports no error identifier;
`packages/rifty/README.md:191` tells consumers to inspect `name`/`message`.
Names crossing today as strings: `SandboxToolchainBusyError`
(`no-coi-toolchain-worker.ts:223,399`; `worker-entry.ts:225,248,270`),
`SandboxResidentToolBusyError` (`:218`), `SandboxRestartBusyError`
(`sandbox.ts:432-435`), `SandboxPersistenceError` (`worker-fs-rpc.ts:164`),
`SandboxResidentPortOwnershipError` (`resident-node-entry.ts:39`). A snapshot
applied onto non-empty payload targets throws a plain `Error` from
`no-coi-snapshot-application.ts`. An occupied namespace: the replica guard
retries every 25 ms up to `ioReportTimeoutMs` (30 s) and then rejects as
`OpfsPreloadError('OPFS replica writer is unavailable or already occupied')`
(`opfs-replica-store.ts:36-76,176-181`, ADR-0428) — but the host-side
handshake deadline (`startupTimeoutMs`, default 10 s, `host.ts:170,433`)
fires first under defaults with a message naming no cause, so the second
opener cannot tell occupied from any other startup failure. Workbench, by
contrast, exports 12 classes (`packages/workbench/src/workbench/errors.ts`).

Goal obligations: I1 (identified as occupied whichever deadline fires first,
native contention cause attached, documented retryable after the holder
closes; `OpfsPreloadError` identity on guard expiry kept — ADR-0428
unchanged), I2 (busy / occupied / snapshot conflict and mismatch /
restart-busy / persistence discriminable from the SDK root; the README states
which are retryable and when). The user's snapshot decision (goal Decisions
2026-09-27): apply into an empty target, otherwise a typed conflict — no
identity bookkeeping.

## Out of scope

- Any queue, retry or wait added on the SDK side (ADR-0376 D1).
- Changing the occupied wait (ADR-0428), the guard (ADR-0425 D7) or the
  startup deadline semantics (ADR-0419).

## Decisions

- identifier form (classes with re-attachment across the Worker hop vs name
  constants + predicates) is decided at pickup with a `rejected route:` line;
  public API → ADR at pickup (`DEC` IRREVERSIBLE).
- occupied-under-startup-timeout carrier (the Worker's observed contention
  travelling to the host-side timeout error; depends on a pre-`ready` phase
  post from `sdk-boot-and-snapshot-progress-events`) at pickup.
