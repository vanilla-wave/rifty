---
area: distribution
status: ready
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

1. Carrier rows 1–14 of `isolate-host-sandbox-acceptance` pass (`it`) → I1–I7, I9
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
5. A packed consumer (`pnpm pack`, fresh install, plain `node`) runs the
   README's sandbox snippet: `createSandbox` → write → exec → readFile
   (`packed-consumer.test.ts`) → I8

## Fault matrix

One rule for guest-authored values: the end state is made in the guest's
realm, so the worker judges its type and size before any frame and the
consumer decodes it before it becomes state; whatever that realm does —
over the cap, not bytes, a throw, a hang — is that call's own result
(`stateRefused`, or `timeout` for a hang) with the state of before, and a
neighbour on the same worker gets its exact result. The protocol-violation
path is only for frames an honest worker never sends.

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| worker lost twice × run | rejects `ERR_ISOLATE_HOST_WORKER_LOST`; state of before | `sandbox-faults` "lost twice" | → I1 |
| worker sends the end state, then dies before its terminal frame | lost, rerun, lost: `WORKER_LOST`; state unchanged (state changes only at a terminal `exit`) | `sandbox-faults` "state frame and dies" | → I1 |
| end state too large to capture in its isolate × run | own stdout/exit + `stateRefused: 'ERR_ISOLATE_HOST_SANDBOX_CAPTURE'`; state of before; both views agree | `sandbox-faults` "capture out of memory" | → I1 |
| state too large to restore in the run's isolate × run | `{stdout: '', stderr: '', exitCode: null, stateRefused: 'ERR_ISOLATE_HOST_SANDBOX_RESTORE'}`; state unchanged; next run fine | `sandbox-faults` "restore refused" | → I1 |
| deadline during the restore of a large state | `timeout`; state unchanged; next run fine | `sandbox-faults` "deadline during restore" | → I1, I6 |
| guest realm makes the capture over the cap / not bytes / throw / hang, next to a neighbour | `stateRefused` / `timeout` with the state of before, or (a codec whose captures resist the poison) the run's state kept; never a rejection; neighbour exact; worker kept | `sandbox-faults` "guest-authored end state" ×4 | → I1, I7 |
| guest replaces intrinsics its capture uses × capture | the exec resolves, the sandbox goes on | `sandbox-faults` "poisoned capture" | → I1, I7 |
| hostile worker: `state` frame for a `runCode` call, oversized, twice | `isolate-host child protocol violation`; state unchanged | `sandbox-faults` "hostile worker" ×2 | → I7 |
| hostile worker: corrupt state bytes under the cap | `stateRefused: 'ERR_FS_SNAPSHOT_CORRUPT'`; state unchanged | `sandbox-faults` "corrupt state bytes" | → I7 |
| `createSandbox({ snapshot })` corrupt / over `maxFsBytes` | rejects the codec's code | `sandbox-faults` "creation from a snapshot" | → I9, I7 |
| destroy during a run in its isolate | rejects DESTROYED; the isolate disposed (worker gives its memory back) | `sandbox-faults` "destroy during a run" | → I5 |
| run past `timeoutMs` × its isolate | `timeout`; isolate disposed | `sandbox-faults` "past timeoutMs" | → I6 |
| a run queued behind another × its deadline | counted from leaving the queue | `sandbox-faults` "leaves the queue" | → I6 |
| a spinning run in sandbox A × a run in sandbox B | B returns first (per-sandbox order only) | `sandbox-faults` "independent" | → ADR-0568 |
| a name over 16 383 code units (ADR-0567) × host op / guest write | host op: Node's `ENAMETOOLONG` at once; a run that made one: `stateRefused: 'ERR_FS_SNAPSHOT_TOO_LARGE'`, state of before | `sandbox-faults` "names the snapshot cannot hold" | → I6, I7 |
| state bytes worker → isolate × view of a larger buffer | an exact copy crosses | `protocol.test.ts` "decodeState" | → I7 |

## Out of scope

The goal's `## Out of scope`; the four codec-dependent REDs turn green on the snapshot goal's codec, not on a stand-in.

## Decisions

- ready-verdict: 2026-11-22 — Contract+RED @ 16b7ab607 (verify pass; first pass @ 0c90e7f79 BLOCKER, 7 fixed; JSON on PR #419)
- 2026-11-22 — exec state frame: worker → consumer one `state` frame per exec call, before its terminal `exit`; payload ≤ `maxFsBytes`.
- 2026-11-22 — stdout writes already cross as exact copies: a guest writing 20 one-byte views of a filled 150 MiB buffer peaks its worker at 288 MiB, the same as without the writes (probe on 50c9d8bf1).
- re-cut: 2026-11-22 — added the long-name row after the codec's Final+GREEN round 1 bounded names (manager, PR #418 @ 62a73512e); RED shown red (host write gave `ERR_ISOLATE_HOST_SANDBOX_FULL`) before the fix — trace: I6, I7
