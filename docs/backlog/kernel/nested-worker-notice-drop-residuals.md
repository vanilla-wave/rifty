---
area: kernel
status: draft
title: A realm that ends itself right after terminating a nested Worker is retained by Chromium
created: 2026-10-25
why: ADR-0548 covers ancestor kills only; a guest kill or child exit followed by the realm's own exit still drops the child's termination notice and leaks the realm thread and every ancestor
user_story: As a dev whose Node script kills its child process and then exits, I want every Worker thread released, but today the script's realm and its parent stay alive until reload
sources: [docs/adr/kernel/0548-ending-realms-leave-nested-workers-to-the-context-destruction-cascade.md, docs/process/traps.md]
code: [packages/kernel/src/process-manager.ts, packages/kernel/src/spawn-worker.ts, packages/kernel/src/worker-entry.ts, packages/runtime-js/src/ipc/no-coi-child-process.ts, packages/workbench/src/support/support-worker.ts]
---

## Context

Mechanism and standalone repro: ADR-0548 §Context, trap
`nested-worker-notice-drop`. ADR-0548 releases nested Workers only in a realm
an ancestor kill is ending. A realm that ends on its own after an explicit
nested `terminate()` is not covered.

Observed on the ADR-0548 tree (macOS arm64, Chromium 148.0.7778.96, 2026-10-25),
temporary browser-unit probe: `top` spawns `mid` 20 times; `mid` spawns `leaf`,
then on `leaf` stdout calls `leaf.kill('SIGTERM')` and, in `leaf`'s `close`
handler, spins 50 ms and calls `process.exit(0)`. `node top.mjs` exits 0;
6 s later 21 extra Workers remain (20 `mid` + `top`), 2 of 2 runs. Same
script shape as `tests/browser-unit/nested-worker-retirement.spec.ts` with
`MID` replaced by the above.

Standalone (no rifty): parent `terminate()`s child, busy 5 ms, `close()` in
the same task → 15/15 retained; a `setTimeout(0)` before `close()` → 0/15, but a
yield before a later busy period still retained 15/15.
No script-visible signal follows Chromium's `WorkerThreadTerminated`, so no
yield or deadline proves the notice ran.

Other shapes of the same drop, not measured:

- Workbench shutdown over a live run at the owner level: the owner terminates
  its run Workers while live, then self-closes; 0 of 15 rounds retained in
  `nested-worker-retirement.spec.ts` after ADR-0548.
- Direct kill of a nested intermediate process whose host survives: frames
  carry `cascade: false` before the host fences it; no product caller
  (`process.kill(pid)` and shell `kill -TERM` are loud gaps).
- `spawnKernelWorker` `rollbackFailedSpawn`, `no-coi-child-process.ts`
  cleanup `terminate()`, `support-worker.ts` child `terminate()` followed by
  `check-sandbox-support.ts` terminating the support Worker.

Owner: kernel process lifecycle. Trigger: a zero-Worker poll or renderer
thread growth after a guest-initiated exit, or a Chromium release that changes
the drop. Next probe: commit the 21-Worker carrier above as RED, then decide
between an upstream Chromium report (publishing — user confirm) and a
topology that keeps Workers out of guest realms.

Dedup: no backlog item, goal map, trap or declined concept covered the drop
before ADR-0548; this records only what ADR-0548 leaves.
