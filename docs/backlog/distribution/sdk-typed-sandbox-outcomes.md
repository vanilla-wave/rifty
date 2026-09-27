---
area: distribution
status: draft
title: Export typed sandbox outcomes (busy, occupied, snapshot conflict, restart-busy, persistence) from @riftydev/sdk with a retryable table
created: 2026-09-27
why: every SDK failure crosses the boundary as a bare Error whose name the host must string-match; nothing is exported and nothing says which outcomes are safe to retry
epic: no-coi-agent-host-kit
sources: [ADR-0376, ADR-0418, ADR-0420, ADR-0425, ADR-0428, docs/backlog/distribution/reference/no-coi-agent-host-kit-evidence.md]
code: [packages/rifty/src/index.ts, packages/rifty/src/sandbox.ts, packages/rifty/src/sandbox-project.ts, packages/workbench/src/workers/no-coi-toolchain-worker.ts, packages/runtime-js/src/worker-entry.ts, packages/vfs/src/opfs-replica-store.ts]
---

## Context

Finding. `packages/rifty/src/index.ts` exports no error identifier;
`packages/rifty/README.md:191` tells consumers to inspect `name`/`message`.
Names crossing today as strings: `SandboxToolchainBusyError`
(`no-coi-toolchain-worker.ts:223,399`; `worker-entry.ts:225,248,270`),
`SandboxResidentToolBusyError` (`:218`), `SandboxRestartBusyError`
(`sandbox.ts:432-435`), `SandboxPersistenceError` (`worker-fs-rpc.ts:164`),
`SandboxResidentPortOwnershipError` (`resident-node-entry.ts:39`); the
occupied namespace surfaces as `OpfsPreloadError('OPFS replica writer is
unavailable or already occupied')` (`opfs-replica-store.ts:176-181`) after the
ADR-0428 retry window, indistinguishable from other preload failures without
a substring match; a snapshot applied onto non-empty payload targets throws a
plain `Error('...')` from `no-coi-snapshot-application.ts`. Workbench, by
contrast, exports 12 classes (`packages/workbench/src/workbench/errors.ts`).

Goal obligations: I1 (occupied identified, cause attached, documented
retryable after the holder closes), I2 (busy / occupied / snapshot conflict
and mismatch / restart-busy / persistence discriminable from the SDK root; the
README states which are retryable and when). The user's snapshot decision
(goal Decisions 2026-09-27): apply into an empty target, otherwise a typed
conflict — no identity bookkeeping.

## Out of scope

- Any queue, retry or wait added on the SDK side (ADR-0376 D1).
- Changing the occupied wait (ADR-0428) or the guard (ADR-0425 D7).

## Decisions

- identifier form (classes with re-attachment across the Worker hop vs name
  constants + predicates) is decided at pickup with a `rejected route:` line;
  public API → ADR at pickup (`DEC` IRREVERSIBLE).
