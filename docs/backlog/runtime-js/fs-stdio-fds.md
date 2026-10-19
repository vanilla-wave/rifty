---
area: runtime-js
status: ready
title: `fs` operations on stdio fds 0, 1, 2 behave as in Node (`fs.read(0)`, `fs.readFileSync(0)`, `fs.writeSync(1)`, `fs.fstat(0)`)
created: 2026-10-16
why: the fs fd table starts at 3, so every fs call on a stdio fd throws EBADF (or a path-type error for `readFileSync(0)`); Go's wasm_exec reads stdin via `fs.read(0, …)` and common Node CLIs read stdin via `fs.readFileSync(0)`
epic: esbuild-upstream-twin
sources: [docs/backlog/npm-client/reference/esbuild-upstream-twin-refine-evidence-2026-10-16.md]
code: [packages/runtime-js/src/builtins/fs.ts]
---

## Context

Finding (2026-10-16, evidence §Node-surface gaps), rifty vs Node 24.16.0:

- `echo hi | node -e "require('fs').read(0,Buffer.alloc(10),0,10,null,(e,n,b)=>console.log('READ',e&&e.code,n,b&&b.toString('utf8',0,n)))"`
  → `READ EBADF undefined undefined` vs `READ null 3 hi`.
- `echo hi | node -e "…readFileSync(0,'utf8')…"` →
  `fs path must be string, Buffer, or URL` vs `"hi\n"`.
- `node -e "require('fs').writeSync(1,'WS1\n')"` →
  `Error: EBADF: bad file descriptor, write` vs `WS1`.
- Stock esbuild-wasm CLI: `✘ [ERROR] Could not read from stdin: read /dev/stdin: Bad file number`.

`fdTable` / `nextFd = 3` (`fs.ts:157-158`); `getFd` throws EBADF for any fd
not opened by `open` (`:428`). `process.stdin.fd === 0`, `process.stdout.fd
=== 1` already.

## Challenge

challenge: 2026-10-20 — clear; goal premise unchanged. Existing stdio sends
MessagePort frames; a blocked child cannot dispatch them. One kernel-owned
input queue, read through the existing SAB RPC, supplies synchronous input
without duplicating the stream's consumption.

## Acceptance

1. Pipe stdin: readSync followed by readFileSync consumes each byte once;
   EOF returns empty bytes; close makes further fd reads EBADF. → I3
2. fs.read(0) consumes its prefix; process.stdin subsequently receives the
   remaining bytes and EOF from the same input owner. → I3
3. fstat(0) identifies the input endpoint; writeSync/write on 1/2 use the
   process's output and preserve order with process.stdout/stderr.write. → I3

## Reference contract

Node v24.16.0. `tests/browser-unit/fs-stdio-fds.spec.ts` runs the same script
with real shell pipes on Node and Chromium. Current RED: no result file;
read/readSync/fstat(0) reject EBADF, readFileSync rejects numeric fd as path.
`RIFTY_PLAYGROUND_PORT=5835 pnpm playwright test --config playwright.browser-unit.config.ts tests/browser-unit/fs-stdio-fds.spec.ts`.

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| observable-order × mixed stream/fd reads | prefix/tail consumed exactly once | shared-stdin differential | → I3 |
| torn-state × input EOF/close | buffered data before EOF; later reads EBADF | sync-stdin differential | → I3 |
| peer death × pending stdin operation | terminal error, no retained request | worker-stdin.test.ts | → I3 |

## Out of scope

Existing unrelated fs capabilities and no-COI child-process loading.
No claim that transport syscall latency equals a host OS pipe.

## Decisions

- 2026-10-20 — RDY-8 observed-defect baseline + RED precede repair.
- 2026-10-20 — mechanism sweep: kernel SAB RPC already owns one request per
  caller; stdio MessagePorts already own readiness delivery; Writable owns
  write serialization. Reuse them. Input bytes have one bounded queue at the
  physical child owner, not a duplicate async/sync replay ledger. A queued
  write holds until accepted; terminal teardown releases pending operations.
- 2026-10-20 — shell `2>&1` is a separate existing loud gap; the carrier
  uses supported pipes, without changing shell grammar.
