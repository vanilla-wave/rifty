---
area: runtime-js
status: draft
title: Same-realm child async throws must fail the child, not the owner
created: 2026-07-28
why: timer, IPC, and signal callbacks in the same-realm child run outside the child's error boundary, so an async throw escapes to the owner realm while the child still reports success
user_story: As a developer whose program throws from a `setTimeout` callback, I want the child to print the stack and exit non-zero like Node, but on the same-realm fallback path the owner realm takes the uncaught error and the child closes with code 0.
sources: [ADR-0326, Node-v24.16.0-probe]
code: [packages/runtime-js/src/builtins/child_process-exec.ts]
---

## Context

`child_process-exec.ts` wraps the guest's timers (`localSetTimeout` ~:197,
`localSetInterval` ~:215, `localSetImmediate` ~:226) with `finally`-only
blocks, and `invokeGuest` (~:246) rethrows anything that is not
`RIFTY_PROCESS_EXIT`. Fork `'message'` dispatch and the `SIGUSR2` handler go
through the same path. A throw therefore lands on the OWNER realm's global
handler, while the lifecycle loop sees empty timer sets, finishes cleanly, and
the child settles `close(0, null)`. Node 24: parent unaffected, stack on the
child's stderr, `close(1, null)`.

Not reachable in the production journey: `spawn('node', …)` takes the Worker
route whenever SAB IPC and the kernel/node-entry worker URLs are present, which
is every COI-hosted realm (`child_process.ts` route check ~:270). The
same-realm path serves non-isolated hosting, the forced `RIFTY_FALLBACK_NO_SAB`
mode, and unit realms — so this is fallback fidelity, not the shipped loop.

Found during the PR #201 review sweep; recorded rather than fixed because the
repair belongs with the same-realm lifecycle owner (one error boundary around
every guest callback that also routes the failure into the child's exit), not
bolted onto individual wrappers.

## Fork to settle

Whether the same-realm path keeps its own boundary or the fallback is retired
in favour of a single Worker-backed implementation once non-isolated hosting
drops out of scope.
