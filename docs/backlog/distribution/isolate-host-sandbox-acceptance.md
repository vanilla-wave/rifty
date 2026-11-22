---
area: distribution
status: draft
title: Isolate host sandbox acceptance carrier — the agent's fix loop over one sandbox as executable tests against real node <path>
created: 2026-11-22
why: First unit of goal isolate-host-live-sandbox; the scenario must be executable and RED before the sandbox exists.
epic: isolate-host-live-sandbox
blocked_by: []
sources: [docs/backlog/epics/isolate-host-live-sandbox/goal.md, docs/backlog/distribution/reference/isolate-host-sandbox-step0.md, docs/adr/distribution/0563-run-runcode-in-a-pool-of-long-lived-worker-processes-each-hosting-many-isolates.md]
code: [packages/isolate-host/tests/sandbox-acceptance.test.ts, packages/isolate-host/tests/support.ts]
---

## Context

Goal scenario steps 1–9 as tests in
`packages/isolate-host/tests/sandbox-acceptance.test.ts` (vitest project
`isolate-host`, global setup = the real package build). The oracle is
`support.ts` `nodeSequence`: consecutive `node <path> [args]` processes of the
same Node executable over one fresh temporary directory, empty env, its real
path read as `/workspace`. The API is typed in the test from the goal's
contract until it exists. Committed RED: every case `it.fails`, failing at
`createSandbox` (run 2026-11-22: 8 expected failures pass). Error reports are
compared through `errorView` — the error line and the user files its frames
name, in order; positions and Node's header/footer are the runtime-js
diagnostics goal's.

## Challenge

challenge: 2026-11-22 — inherits the goal premise check (`goal.md` §Challenge)

## Acceptance

1. Buggy `main.js` + binary `input.bin` → exit 1, stdout and `errorView`
   equal to node's (`ReferenceError: makePdf is not defined` in
   `/workspace/main.js`); the fixed `main.js` + `lib/pdf.js` with
   `args: ['out/report.pdf']` → exactly node's result (`wrote out/report.pdf
   true`), the file tree and `out/report.pdf` bytes equal node's → I2, I3
2. A busy loop past `timeoutMs` 1500 → `timeout`; heap growth and `new
   Array(2 ** 28).fill(0)` at `memoryLimitMb` 64 → `memory`; each run's
   `partial` write is absent after it, earlier files intact; the next run
   reads them → I1
3. Two runs (`a.js` sets a global, `exitCode` 3, an `exit` listener, `chdir`,
   a module-cache counter, a timer, writes `n.txt`; `b.js` prints what is
   left): each run's result and file tree equal node's sequence → I2
4. `writeFile(v1)`, `exec`, `writeFile(v2)`, `exec`, `readFile` issued without
   awaiting: `v1`, `v2`, then the second run's file → I4
5. `destroy()` during a busy run with a write queued behind it: both reject
   `ERR_ISOLATE_HOST_SANDBOX_DESTROYED`, as do later `readFile`/`exec` → I5
6. `readFile` of a missing path → `code: 'ENOENT'`, `path:
   '/workspace/nope/out.pdf'`, no host cwd in the message; a NUL in a path →
   `ERR_INVALID_ARG_VALUE`; sandbox B's guest does not see A's
   `secret.txt` (`false ["peek.js"]`) → I6, I7
7. Write, run (creates `made.bin`), `snapshot()`, destroy, `createSandbox({
   snapshot })`: same tree; a run there reads `made.bin` → I10
8. An ESM entry (`main.mjs`; node runs it, exit 0) → exit 1 with
   `Not implemented: isolate-host.esm` on stderr → I2

## Out of scope

The goal's `## Out of scope`. Fault-matrix rows (worker loss, hostile
frames/state bytes, size limits, view-range copies, the run sequence corpus)
live in the units the carrier exposes, each with its own carrier.

## Decisions

- 2026-11-22 — RED typed against a local `Sandbox` interface (the goal's API),
  so the carrier type-checks before the export exists; the implementation
  replaces it with the package's types.
