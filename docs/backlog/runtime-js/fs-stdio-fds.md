---
area: runtime-js
status: draft
title: `fs` operations on stdio fds 0, 1, 2 behave as in Node (`fs.read(0)`, `fs.readFileSync(0)`, `fs.writeSync(1)`, `fs.fstat(0)`)
created: 2026-10-16
why: the fs fd table starts at 3, so every fs call on a stdio fd throws EBADF (or a path-type error for `readFileSync(0)`); Go's wasm_exec reads stdin via `fs.read(0, …)` and common Node CLIs read stdin via `fs.readFileSync(0)`
epic: esbuild-upstream-twin
sources: [docs/backlog/npm-client/reference/esbuild-upstream-twin-refine-evidence-2026-10-16.md]
code: [packages/runtime-js/src/builtins/fs.ts]
---

## Context

2026-10-20 — No-COI child work (PR #380) adds async fs.read(0) over the real stdin pipe for upstream esbuild. Other fd-0/1/2 operations and this goal’s COI suite remain this item’s scope.

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

## Question

Which fd-level operations and fd states does the parity seed cover — read on
fd 0 (piped, TTY, closed/EOF), `readFileSync(0)`, `fstat(0..2)` (Node:
`isFIFO()`/`isCharacterDevice()` by stdio kind), write/writeSync on 1/2
ordering with `process.stdout.write`, `close(0)` — and how the fd source binds
to the process's stdio streams without a second reader racing `process.stdin`?
Settled at PICKUP by Node probes; `/dev/stdin` paths stay out unless a probe
shows a Node program depends on them.
