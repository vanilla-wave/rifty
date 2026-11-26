---
area: runtime-js
status: draft
title: A multi-round async fs operation reads the caller's buffer as late as Node's last round before the write
created: 2026-11-26
why: Node's writeFile is open + write + close, each a threadpool round, so a buffer mutation in a setImmediate after the call still lands in the file; a single I/O turn per operation (fs-callbacks-io-turn) does not reach it
sources: [docs/backlog/runtime-js/reference/fs-async-op-io-rounds/moment.cjs, docs/backlog/runtime-js/fs-callbacks-io-turn.md, tools/node-parity-runner/cases/fs/async-write-buffer-moment.case.ts]
code: [packages/runtime-js/src/builtins/fs.ts, packages/runtime-js/src/builtins/fs-streams.ts]
---

## Context

Found 2026-11-26 by the buffer-ownership fix (branch `fix/fs-store-aliases-caller-buffer`): rifty's
async write entries now take the caller's bytes at the call on every host (the memory store no
longer keeps the caller's buffer). Unit 4 (`fs-callbacks-io-turn`) moves each callback/promise
operation into one I/O turn (`ioTurn(op)`), which covers a mutation in the caller's tick, a
microtask or a `nextTick`. Not covered: operations Node runs over several rounds.

Probe `reference/fs-async-op-io-rounds/moment.cjs` (fresh dir per run; `b = new Uint8Array([1,2,3])`,
call, then `b.fill(9)` at the moment; file bytes after completion). Node v24.16.0, macOS arm64:

| entry | Node, `setImmediate` mutation | rifty (all hosts, after the fix) |
|---|---|---|
| `fs.promises.writeFile`, `fs.promises.appendFile`, `fs.writeFile(cb)` | 9,9,9 (60/60) | 1,2,3 |
| `fs.appendFile(cb)`, `FileHandle.writeFile`, `FileHandle.write` | 9,9,9 (60/60; `FileHandle.writeFile` with a `nextTick` mutation 1,2,3 in 2/30) | missing |
| `fs.write(fd, cb)` (one round) | races: 1,2,3 in 28/30 on one run, 9,9,9 in 30/30 on a later one | 1,2,3 |
| open `fs.WriteStream` `write()` | 9,9,9 (60/60) | 1,2,3 |

rifty measured in-process (`inproc.mts` of `docs/backlog/epics/node-streams-as-in-node/reference/`),
isolate (`runCode`), COI Workbench and no-COI SDK (`tests/*/node-file-parity.spec.ts` with the probe
as a temporary program): the same rows on all four. Unit 4's author measured (Node, 20 runs):
`writeFile` 9,9,9 at a mutation right after / in a microtask / in `setImmediate`; `write(fd)` 9,9,9 /
9,9,9 / 1,2,3. Which mutations land past the first round races in Node; the `setImmediate` row of
the whole-file entries does not in 60 runs. Owner: runtime-js fs. Trigger: unit 4 landing (then
re-measure on its turn), or a program refilling a pooled buffer before its write settles. Compat:
`fs.md` ⚠️ row on async writes.

## Question

Does rifty model Node's round count per operation (open/write/close turns), or is one turn per
operation the declared ceiling with these rows ⚠️? Settled by unit 4's turn shape and a re-run of
the probe on it.

## Challenge

challenge: 2026-11-26 — finding capture; no premise critic (README §Challenge)
