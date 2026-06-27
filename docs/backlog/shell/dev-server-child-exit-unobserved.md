---
area: shell
status: active
title: Post-ready dev-server child exit is unobserved (stale LIVE pill on a mid-run crash)
created: 2026-06-17
why: P6b moved the dev server into a serve:true supervised child; the owner driver watches the child's exit only during the boot window and inside stop(). If the child crashes AFTER it reported ready (request-handler throw, OOM), nothing transitions the controller — the LIVE pill stays 'running' and /preview/<port>/ 502s until the user Ctrl-Cs/restarts.
user_story: As a developer whose running dev server crashes mid-session, I want the UI to leave 'running' (LIVE pill clears, preview tears down) and the terminal to show the dev server stopped — instead of a stale LIVE pill over a dead server.
sources: [ADR-0150, ADR-0148]
code: [apps/playground/src/workers/owner-child-dev-server.ts, apps/playground/src/workers/dev-server-controller.ts, apps/playground/src/workers/real-vite-bootstrap.ts]
---

## Context

P6b/ADR-0150 introduced a NEW lifecycle state the co-resident model and P6a's run-to-completion children never had: a long-lived (`serve:true`) child that can exit AFTER becoming ready. The driver (`createOwnerChildDevServer.boot`) attaches `handle.on('exit')` only (a) for the boot window — reject "exited before listening" — and (b) inside `DevServerHandle.stop()` (kill + await exit). Once `boot` resolves on `rifty:dev-ready`, the controller (`dev-server-controller.ts:run`) parks on `await onceAborted(signal)` (Ctrl-C). There is no path observing a post-ready child exit: a crash leaves `status: 'running'`, the page's LIVE pill stays lit, and the preview route 502s (no listener) until the user interrupts. The owner's own `worker.on('exit')` in `realVite.ts` covers the OWNER dying, not the child.

Found by the P6b final whole-branch review (non-blocking — happy path + the gold e2e are unaffected; recoverable by Ctrl-C/restart).

**P6b review fix (2026-06-18):** the Ctrl-C recovery itself used to HANG — `stop()` killed the child then awaited `'exit'`, but `WorkerHandle.kill()` on an already-exited child returns `false` and emits no `'exit'`, so the await never resolved (the dev-run + the controller's `stopped` transition hung forever). `stop()` now resolves when `kill()` returns `false`, so Ctrl-C/restart genuinely recovers. The REMAINING gap here is purely the AUTOMATIC observation: nothing transitions the controller on a post-ready child exit, so the LIVE pill stays lit until the user interrupts.

## Options or Next

A clean fix touches the controller contract (which ADR-0150 deliberately left "state machine unchanged" for P6b), so it is a follow-up, not a P6b in-scope change. Candidates:
- Give `DevServerHandle` an exit signal (e.g. an `AbortSignal`/`Promise` the driver resolves on post-ready child exit) and have `createDevServerController.run` race it against `onceAborted` → on child exit, transition to `stopped` and emit the frame (status stays consistent — the controller owns the transition).
- Or: the boot closure wires a driver `onExit` callback that drives the controller to stop (still needs a controller entry point, so the first option is cleaner).
- Either way: emit a `pty:dev-server { status: 'stopped', error: 'dev server exited (code …)' }` so the page tears the LIVE pill + preview (mirrors `realVite.ts`'s owner-exit synthesized frame).

Relates to ADR-0152 serve-mode keepalive / loud-fail behavior and `shell/owner-graceful-drain-on-terminate`.

## Reversibility

REVERSIBLE — additive supervision (a new exit-observation path + one controller transition); no wire-format change. // TODO(backlog: shell/dev-server-child-exit-unobserved) sits at the post-ready exit gap in `owner-child-dev-server.ts`.
