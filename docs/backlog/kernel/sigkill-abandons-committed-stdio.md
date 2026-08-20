---
area: kernel
status: draft
title: SIGKILL abandons committed-but-undelivered worker stdio bytes
created: 2026-08-20
why: the PR #270 SIGKILL branch routes through `_abandonTerminal` → receiver `abandon()` `clearBuffered()`, dropping chunks the child already committed (bytes + order witness posted) but the parent has not yet projected; on real Linux/Node pipe data written before SIGKILL death stays readable by the parent
sources: [PR #270 inline review 2026-08-20, packages/kernel/src/worker-stdio-drain.ts]
code: [packages/kernel/src/process-manager.ts, packages/kernel/src/worker-stdio-drain.ts]
---

## Context

Deliberate trade recorded in the PR: abrupt death cannot attest complete drain
(`abandonWorkerOutput` docstring) — a writer can die between `postOutput` and
`committed++`, so an exact post-death cut target is unattestable and a drain
wait can strand (the bug PR #270 fixed). The cost: `child.kill('SIGKILL')`
right after the child wrote to stdout may deliver fewer bytes than real Node.
Window is one in-flight admission plus queued-but-unprojected messages.

Intake 2026-08-20: dedup found no match (`binary-stdio-messageport-backpressure`
is framing/flow-control; `sab-ring-protocol-violation-flake` is the sync-RPC
ring). The Node oracle claim ("pre-SIGKILL pipe data is delivered before
'close'") carries no captured parity artifact — open fork, capture via
parity-runner at pickup before any design. A candidate honest middle: deliver
already-projectable chunks (bytes + witness both received) and abandon only the
unattestable tail; needs a fault-matrix row for the die-between-post-and-commit
writer and must not reintroduce the stranded-drain wait.
