---
area: distribution
status: draft
title: Settle the remaining no-COI in-process terminals as Node exits, not realm replacement or crash
created: 2026-09-11
why: A no-COI command or runBin whose guest ends by a no-listener throw, an eval fatal, or an exit while a non-timer handle is live reports failed/crash with the realm replaced, where real Node prints and exits with a status
user_story: As an embedder running agent commands, I want `node -e "Promise.reject(…)"`, a no-listener timer throw, or `process.exit(n)` beside a listening server to report Node's status with known effects, but today the realm is replaced (or the toolchain Worker crashes) and the status is lost.
sources: [docs/adr/distribution/0418-no-coi-project-files-and-invocation-commands.md, docs/adr/distribution/0423-keep-no-coi-invocation-settlement-generic.md, docs/adr/runtime-js/0445-dispatch-node-process-lifecycle-events-before-terminal-handling.md]
code: [packages/workbench/src/workers/no-coi-project-command.ts, packages/workbench/src/workers/no-coi-toolchain-worker.ts, packages/runtime-js/src/internal/event-loop-keepalive.ts]
---

## Context

Since ADR-0445's 2026-09-25 note the drain settles with the process's first
terminal. A no-COI project command maps it to Node's status, clears the
invocation's timers and keeps the realm; runBin ends with a natural `exit()`.
Both end the invocation at every terminal: its timers cleared, its
process/stdio listeners retired (`no-coi-invocation-scope.ts`).
Carrier: `tests/no-coi/no-coi-process-exit-status.spec.ts` (live Node
v24.16.0 oracle): listener throw 7, `exit(n)` in handlers, file-entry fatal
rejection 1, natural `exitCode`, on both hosts.

Still not Node's status (probe 2026-09-25, `sandbox.project().run` / `runBin`),
all loud:

- No-listener uncaught throw (`setTimeout(() => { throw … })`): ADR-0445 rule
  3 keeps the realm's default report, so the toolchain Worker crashes —
  command `failed`, `Worker crashed: Uncaught Error: …`, replaced; runBin
  rejects. Node: stderr + 1.
- `node -e` fatal rejection or throw: the eval lifecycle rejects the drain
  with its projected error (not an exit signal) → `failed`, empty stderr,
  replaced. Node: stderr + 1.
- A terminal while a non-timer handle is live (listening port, pending
  import/fetch, tracked CLI promise): the command replaces the realm →
  `failed`, error `process.exit(n)`. Node: status n.

Not loud: runBin keeps such a handle (ADR-0423 retains live refcounts), so its
callbacks run after runBin returned, in the reused realm; Node's process is
gone. Sibling in-process owners without a natural `exit()`: the Node-hosted
execSync substitutes (`packages/runtime-js/src/ipc/in-process-node-entry-runner.ts`,
parity `run-in-rifty.ts` `runChildSync`) read `exitCode` and emit no `'exit'`,
so an `'exit'` listener's `exitCode`/`exit(n)` is ignored there.

## Options or Next

- Throw: in the toolchain realm, run the fatal terminal at the trap (stderr +
  exit 1) instead of the default report, as a rejection does; COI keeps its
  kernel report unless the same move is decided for both (compat row "Fatal
  throw with an `'exit'` listener").
- Eval: map the eval lifecycle's projected fatal to stderr + exit 1 through
  its existing `terminateUnhandled`.
- Live handles: a host-owned retirement of ports/imports/fetches, or a
  terminal-aware result (`exited`, status, `requiresTermination`) that keeps
  the status while replacing the realm; runBin needs the same.
- When runBin's live-handle gap closes, move the `late createRequire` runBin
  carrier in `tests/no-coi/no-coi-dev-hmr.spec.ts`: it rides a server the rival
  leaves listening after runBin returns.

## Reversibility

REVERSIBLE — invocation settlement policy inside the existing owners.
