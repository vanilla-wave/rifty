---
area: kernel
status: draft
title: MessagePort stdin completion and pipe backpressure
created: 2026-06-08
why: No-COI child stdin reports write completion before delivery and loses EPIPE on unread peer exit.
user_story: As a developer writing a large buffer to an unreferenced child, I want its callback and parent lifetime to follow Node, but no-COI reports success before the child reads or exits.
sources: [ADR-0011, ADR-0539, docs/backlog/kernel/reference/no-coi-stdin-write-completion.mjs, docs/public/compat/process.md]
code: [packages/runtime-js/src/ipc/no-coi-child-process.ts, packages/kernel/src/worker-stdin.ts, packages/kernel/src/worker-stdin-rpc.ts]
---

## Context

2026-10-20 refresh of the existing MessagePort backpressure finding. Its old
JSON-only framing claim was stale: COI now uses binary bounded `WorkerInput`
(64 KiB); no-COI posts stdin bytes and immediately calls the Writable callback.
The no-COI issue exists on main `7f8d0e8d7`, before PR #379's merge.

Same program on Node 24.16.0 and actual Chromium SDK + SW, ephemeral storage:

- 8 MiB write, `child.unref()` and `child.stdin.unref()`, delayed reader writes
  a marker before reading: Node callback sees marker `true`; no-COI `false`.
- 8 MiB write, only `child.unref()`, child exits without reading: Node callback
  and error event report `EPIPE`; no-COI callback is `null`, error events `[]`.

Both parent commands exit 0. Raw review runs:
`/tmp/esbuild-merge-independent-no-coi-pending.log` and
`/tmp/esbuild-merge-independent-no-coi-pending-death.log`.
Durable executable: `reference/no-coi-stdin-write-completion.mjs`.
Start `pnpm --filter @riftydev/playground dev:no-coi`, then from repository root:

```sh
pnpm exec node docs/backlog/kernel/reference/no-coi-stdin-write-completion.mjs http://127.0.0.1:5411
```

Executed unchanged on Node 24.16.0 + Chromium: both rows above reproduced;
`/tmp/esbuild-no-coi-stdin-durable-repro.log`. It prints native/browser results
and exits 1 while mismatches remain.
Compat ❌: `docs/public/compat/process.md`, no-COI stdin completion row.

## Scope and next probe

Owner: runtime-js/kernel. Trigger: no-COI pending writes, unreferenced parents,
peer death, or the next child-pipe backpressure unit. This factual draft does
not prescribe a replacement transport. The broader stdout/stderr backpressure
question from this item remains unmeasured; inspect at pickup.

Class-kill inventory: `WorkerInput`, `registerWorkerInput`, `workerInputReader`
and `bindPortAsWritable` already own COI capacity/completion. No-COI has a
separate immediate MessagePort writer. Reuse or unify the existing authority
before adding another acknowledgment/FIFO mechanism; nested SW caller routing
must be checked before choosing that route.

Dedup: existing item updated; stdio-stream-slot and raw-stdin drafts concern
fd sharing/inheritance and terminal modes, respectively. No declined match.
PR #379 reviewer classifies this outside its accepted result: scenario defaults
to COI; amended I4 retains the no-COI 0.28.0 build/admission baseline, not full
cross-tier I3 parity. No active-goal obligation is deferred here.
