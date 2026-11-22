---
area: distribution
status: draft
title: Isolate host sandbox core — createSandbox, host file ops, exec over the snapshot codec, one operation at a time, destroy
created: 2026-11-22
why: The first wall of goal isolate-host-live-sandbox — the acceptance carrier fails at `createSandbox`.
epic: isolate-host-live-sandbox
blocked_by: []
sources: [docs/backlog/epics/isolate-host-live-sandbox/goal.md, docs/adr/distribution/0568-run-guest-files-in-a-live-sandbox-whose-state-is-filesystem-bytes-held-by-the-consumer.md, docs/adr/distribution/0567-snapshot-the-isolate-guest-filesystem-as-a-versioned-binary-blob.md, docs/backlog/distribution/isolate-host-sandbox-acceptance.md]
code: [packages/isolate-host/src, packages/isolate-guest/src, packages/isolate-host/tests/sandbox-faults.test.ts]
---

## Context

ADR-0568 §1–§8 over ADR-0567's codec (`snapshotFs`/`restoreFs`,
`GuestEntry.snapshot/restore`; branch `t3/isolate-host-fs-snapshot` @
32942b497, merged here; codec bodies land there). Pieces: the guest's program
entry beside `run(code)` (`runNodeEntry` program kind, ESM entry → loud gap);
the run request carrying `entry {path, argv}` and the state bytes, the worker
restoring before guest code and capturing after the run ends, a `state` frame
before the terminal frame; the consumer's `Sandbox` (one operation at a time,
host file ops on a `MemoryFsSync` decoded from the state, destroy). RED: the
acceptance carrier (`sandbox-acceptance.test.ts`, rows 1–11, 13) plus
`sandbox-faults.test.ts` (rows below the scenario level).

## Challenge

challenge: 2026-11-22 — inherits the goal premise check (`goal.md` §Challenge)

## Acceptance

1. Carrier rows 1–11 and 13 of `isolate-host-sandbox-acceptance` pass
   (`it`), row 12 waits for `runtime-js/fs-link-apis-not-implemented` → I1–I7, I9
2. The package root exports exactly `createSandbox` and `runCode`; every
   argument and result of the sandbox is plain data or `Uint8Array`
   (`sandbox-faults.test.ts` "surface") → I8
3. `exec` refuses loudly: `env`/`cwd`/`stdin` →
   `NotImplementedError('isolate-host.sandbox-exec-<option>')`; a non-string
   path, a non-array or non-string `args` → `ERR_INVALID_ARG_TYPE`; an option
   out of range → `ERR_OUT_OF_RANGE` as `runCode`; `createSandbox({ template })`
   → `NotImplementedError('isolate-host.sandbox-template')`; a corrupt
   `snapshot` → rejects `ERR_FS_SNAPSHOT_CORRUPT` → I6, I8
4. `snapshot()` issued behind a running exec holds the files of that run's
   end, and an exec issued behind `snapshot()` does not change it → I9, I4
5. A packed consumer (`npm pack` of both packages, fresh install) runs
   `createSandbox` → write → exec → readFile (`packed-consumer.test.ts`) → I8

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| worker lost twice × run | rejects `ERR_ISOLATE_HOST_WORKER_LOST`; state of before | `sandbox-faults` "lost twice" | → I1 |
| end state too large to capture in its isolate × run | its own stdout/exit + `stateRefused: 'ERR_ISOLATE_HOST_SANDBOX_CAPTURE'`; state of before | `sandbox-faults` "capture out of memory" | → I1 |
| state too large to restore in the run's isolate × run | `{stdout: '', stderr: '', exitCode: null, stateRefused: 'ERR_ISOLATE_HOST_SANDBOX_RESTORE'}`; state unchanged | `sandbox-faults` "restore refused" | → I1 |
| guest replaces intrinsics the codec uses × capture | the exec resolves (never rejects, never `WORKER_LOST`); the sandbox goes on with a state that decodes | `sandbox-faults` "poisoned capture" | → I1, I7 |
| hostile worker: `state` frame for a `runCode` call, twice, oversized | `isolate-host child protocol violation`; state unchanged | `sandbox-faults` "hostile state frame" (replaced `dist/child.js`) | → I7 |
| run past `timeoutMs` / destroyed × its isolate | disposed as a `runCode` call at its deadline (ADR-0563 §4) | inherited: `pool-faults.test.ts` time rows (same cancel path) | → I5, I6 |
| state bytes worker → isolate × view of a larger buffer | only the range crosses: the worker hands the isolate an exact copy | code review mutant (subarray vs slice) | → I7 |

## Decisions

- 2026-11-22 — exec state frame: worker → consumer one `state` frame per exec call, before its terminal `exit`; payload ≤ `maxFsBytes`.
- 2026-11-22 — stdout writes already cross as exact copies: a guest writing 20 one-byte views of a filled 150 MiB buffer peaks its worker at 288 MiB, the same as without the writes (probe on 50c9d8bf1).
