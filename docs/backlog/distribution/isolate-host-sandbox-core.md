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
| a name over 16 383 code units (ADR-0567) × host op / guest write | host op: Node's `ENAMETOOLONG` at once; a run that made one: `stateRefused: 'ERR_ISOLATE_HOST_SANDBOX_CAPTURE'` (the guest's codec refuses the name before any bytes exist: nothing for the trusted side to measure), state of before | `sandbox-faults` "names the snapshot cannot hold" | → I6, I7 |
| a run's state × the run's memory limit swept across the restore boundary | the run sees all its files or no guest code runs (`RESTORE`/`memory`); state intact | `sandbox-faults` "restore at the memory boundary" | → I1 |
| guest-made NaN/Infinity times or a NUL name × the next run's restore | as Node: the calls throw (`ERR_INVALID_ARG_TYPE`, `ERR_INVALID_ARG_VALUE`), nothing unrestorable is written | `sandbox-acceptance` corpus "utimes with NaN…" | → I1, I2 |
| snapshot bytes in / out × the caller's buffer | copies both ways | `sandbox-faults` "never aliased" | → I3 |
| guest error text from a broken capture × host | never crosses: a fixed code | `sandbox-faults` "throws" (`evil /secret/path`) | → I7 |
| the worker ends a sandbox run itself (the `import()` gap via `vm`, plain and in a timer) next to a neighbour | the run's result (exit 1, the gap text, `stateRefused` CAPTURE); never a protocol violation; neighbour exact | `sandbox-faults` "every early end" | → I1, I7 |
| host bytes in/out × a pooled `Buffer`, a view with an offset, `readFile`/`snapshot()` results | exact copies, no shared memory | `sandbox-faults` "Buffer inputs" | → I3 |
| every host-op refusal × its error object | fields and `stack` name only sandbox paths; `stack` is the first line | `sandbox-faults` "no consumer frames" | → I7 |
| the worker's result channel closes mid sandbox run (after `state`, before `exit`; before any frame), a `runCode` neighbour on it | lost worker (ADR-0563 §6): rerun once alone, then `WORKER_LOST`; state as before (adopted only at a terminal `exit`); the neighbour rerun, its result exact once | `sandbox-faults` "result channel closed" ×2 | → I1, I7 |
| runCode's hardening through `exec` (no `fetch`/`http`/`child_process`, `allowSharedArrayBuffer: false`, `maxOutputBytes`), a 1 MiB round trip, a dropped sandbox | as `runCode`; bytes exact; the consumer exits on its own | `sandbox-faults` "hardening and options" ×3 | → I3, I6 |
| destroy of a light run on a shared worker | resolves at the cancelled run's terminal frame; the worker and its neighbour stay | `sandbox-faults` "light run" | → I5 |
| destroy after a timed-out run whose isolate is still stopping (a builtin ignoring termination) | destroy resolves once that isolate left its worker | `sandbox-faults` "timed-out run waits" | → I5 |
| the operation queue × a large result | keeps no result: a dropped `snapshot()` is collectable | `sandbox-faults` "keeps no result" (`--expose-gc`) | → I6 |
| a refused overwrite past the cap | the old bytes stay | `sandbox-faults` "refused overwrite" | → I3, I6 |
| input bytes × the caller changing its buffer while the op waits | the bytes at the call | `sandbox-faults` "bytes at the call" | → I3 |
| an unknown option name of `createSandbox`/`exec`; the sandbox object | `ERR_INVALID_ARG_VALUE`; no own enumerable state | `sandbox-faults` "unknown option names" | → I8 |
| a call reported `memory` while a builtin still holds its isolate × a new call | the slot stays taken until `gone`: the new call gets another worker | `sandbox-faults` "keeps its slot on every end" | → I5 |
| `maxFsBytes` below an empty sandbox's codec cost | `createSandbox` rejects `ERR_OUT_OF_RANGE` (the number from the codec); at the least it works | `sandbox-faults` "cap below an empty sandbox" | → I6 |
| the state fails to encode at placement (test limit at the pool seam) | the call rejects; no phantom call holds a slot or a waiter | `sandbox-faults` "no phantom call" | → I5 |
| `exec` args/options and `createSandbox` options × the caller changing them while the op waits | the values at the call | `sandbox-faults` "fixed at the call" | → I3 |
| destroy in flight × the run's end state | no hold on it: collectable (`--expose-gc`) | `sandbox-faults` "no hold on the run" | → I6 |
| a hostile worker's `gone`: before the terminal frame, for a call not on it, a second one | protocol violation: the call rejects / the worker is killed; no slot or destroy freed early | `protocol.test.ts` "gone before the terminal frame", "gone for a call not on this worker", "a second gone" | → I4, I5 |
| destroy between the run's result and the exec's continuation | the exec rejects `DESTROYED` | `sandbox-faults` "its continuation" | → I5 |
| destroy × every end (exit, timeout, memory, catastrophic, refused state, worker lost) × every moment (before start, in flight, 0–3 microtasks after the result, after `await`) | no worker burns CPU after `destroy()` returns (a worker dying in the window keeps its last reading) | `sandbox-destroy-table` (32 rows) | → I5 |
| a worker sends a terminal frame and never `gone` | the worker is retired after the stuck grace and ends; destroy resolves | `protocol.test.ts` "never followed by gone" | → I4, I5 |
| warm `runCode` bursts × the slot rule | terminal frame and `gone` in one write: no cold worker | `sandbox-faults` "bursts stay on one warm worker" | → I8 |
| a request write that throws half-way | the call rejects with the error, no rerun; that worker ends | `sandbox-faults` "half-written" | → I5 |
| a host write refused over the cap (overwrite, new file, new directories, new top directory) × the next run's `stat` | the same bytes and the same four times of the file and every directory above it | `sandbox-faults` "times included" | → I3, I6 |
| state bytes worker → isolate × view of a larger buffer | an exact copy crosses | `protocol.test.ts` "decodeState" | → I7 |

## Out of scope

The goal's `## Out of scope`; the four codec-dependent REDs turn green on the snapshot goal's codec, not on a stand-in.

## Decisions

- ready-verdict: 2026-11-22 — Contract+RED @ 16b7ab607 (verify pass; first pass @ 0c90e7f79 BLOCKER, 7 fixed; JSON on PR #419)
- 2026-11-22 — exec state frame: worker → consumer one `state` frame per exec call, before its terminal `exit`; payload ≤ `maxFsBytes`.
- 2026-11-22 — stdout writes already cross as exact copies: a guest writing 20 one-byte views of a filled 150 MiB buffer peaks its worker at 288 MiB, the same as without the writes (probe on 50c9d8bf1).
- re-cut: 2026-11-22 — added the long-name row after the codec's Final+GREEN round 1 bounded names (manager, PR #418 @ 62a73512e); RED shown red (host write gave `ERR_ISOLATE_HOST_SANDBOX_FULL`) before the fix — trace: I6, I7
- re-cut: 2026-11-22 — the guest-authored row widened after Contract+RED to accept a codec whose capture resists the poison (state kept, never a rejection) — the reviewer's concern; no defect hidden: the real codec takes the refused/timeout branch for all four poisons — trace: I1, I7
- re-cut: 2026-11-22 — Final+GREEN round 1 blockers: destroy resolves once the run has left its worker; boot `memory` stays `memory`. Rows added: destroy read at resolution, boot memory, buffer copies, stateless exit violation, refused write leaves no new directories (each RED shown red: mutants N1–N7) — trace: I1, I3, I5, I7
- re-cut: 2026-11-22 — codec external review (manager): rows for the restore boundary, guest-made NaN/Infinity/NUL, snapshot aliasing, guest error text; the NUL row was red (rifty created the name; fixed at `fs-path.ts`, Node's `nullCheck`) — trace: I1, I2, I3, I7
- re-cut: 2026-11-22 — boundary audits (manager): one terminal for sandbox runs (the `import()` gap no longer reads as a protocol violation), reason codes measured by the trusted side (`TOO_LARGE` only for measured bytes, a throwing capture is `CAPTURE`), exact copies for `Buffer` inputs/outputs, sizes before copies, bare `stack`; REDs shown red (A1–A3 mutants, and the rows failed before the fix) — trace: I1, I3, I7
- re-cut: 2026-11-23 — Final+GREEN re-bind r4 blocker: an end state over the cap is named by the trusted side again (the guest's codec is asked up to the isolate's memory; the worker or the consumer's codec measures the cap), row 10 holds as written, the long-name row is re-cut to CAPTURE (no bytes to measure); mutants R1 (never TOO_LARGE) and R2 (no release at the terminal frame) killed — trace: I1, I5, I6
- re-cut: 2026-11-23 — external review round 1 (manager): rows for destroy after a timed-out run, the queue keeping no result, refused overwrite, call-time input copies, unknown options; the run's state is boxed (a run finishing after destroy writes into an unreferenced box) instead of a destroyed check; the consumer's memory per run cut from ≈ 6.7 S to ≈ 4 S + 8 MiB (state encoded per attempt, base64 written in pieces); mutants X1–X5 killed — trace: I3, I5, I6, I8
- re-cut: 2026-11-23 — external review round 2 (manager): a run leaves its worker on one `gone` event after both its terminal frame and its isolate's unwind, on every end (destroy and slots read it; before, a memory end freed both at the result); the state is encoded before the call registers; a `maxFsBytes` floor at the empty sandbox's cost; every input fixed at the call; `#run` cleared at settle; `timeoutMs` covers the consumer's encode (README fixed); the memory formula is an upper bound (5 × S + 16 MiB); utimes clamps to ±Date range (`-1e306`, parity red→green); mutants G1–G7 killed (G6/G7 by timing/throw injected at the pool seam) — trace: I3, I5, I6
- re-cut: 2026-11-23 — Final+GREEN r9 blocker (mutant Z4: any `gone` accepted, uncarried): hostile-worker rows for `gone` added; mutants Z4/Z4a/Z4b killed — trace: I4, I5
- re-cut: 2026-11-23 — external review round 3 (manager): I5 by construction — each call's one "left" event registered with the sandbox at the call's creation, destroy waits for all; the every-end destroy rows replaced by a table end × moment with CPU kept for a worker dying mid-window; consumer-side stuck grace for a missing `gone`; terminal frame + `gone` in one write; half-written request documented as reject-no-rerun; utimes sign as Node on darwin (parity exact on darwin hosts, Linux EINVAL compat ⚠️); mutants T1–T8 and the round-2 set re-run — trace: I4, I5, I8
- re-cut: 2026-11-23 — Greptile observation (REV-12, PR #419 thread on `sandbox.ts:290`): a refused write's rollback left new `mtime`/`ctime`; the rollback now restores the times of the target and every existing directory above it (`restoreStatSync`; no window: host ops are serialized and no run reads the FS in between); RED shown red, mutants W1/W2 killed — trace: I3, I6
