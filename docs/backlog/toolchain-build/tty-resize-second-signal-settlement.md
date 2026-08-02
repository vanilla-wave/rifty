---
area: toolchain-build
status: draft
title: TTY parity — settle the second native resize signal before capture
created: 2026-08-02
why: the exact two-axis Node TTY oracle prints after a fixed 50 ms, and one full PR gate captured only the first 132x24 transition before the second native SIGWINCH updated rows to 43
user_story: As a maintainer running Node parity, I want the real-PTY resize oracle to wait for its contracted second transition so a scheduler delay cannot report a false rifty mismatch
sources: [ADR-0338]
code: [tools/node-parity-runner/src/run-in-node.ts, tools/node-parity-runner/cases/process/tty-resize.case.ts]
---

## Context

`pnpm pr:check` at `888de991d` failed only
`process/tty-resize.case.ts`. Node produced the exact first transition and then
captured at the case's fixed 50 ms boundary:

```text
{"final":"132x24","events":["stdout:132x24","stderr:132x24","SIGWINCH:132x24"]}
```

Rifty produced ADR-0338's complete `132x24` then `132x43` six-event trace.
An immediate isolated `pnpm test:parity` rerun passed all 245 cases, including
TTY resize. This is an `observable-order` / `frozen-assumption` carrier flake:
the native preamble chains the row change from the first `SIGWINCH`, but the
case captures after elapsed time rather than settlement of the second signal.

Dedup: `toolchain-build/portable-tty-script-launcher` concerns unsupported BSD
`script(1)` argv dialects before the Node oracle starts; it does not cover a
started Darwin PTY whose second transition arrives after capture.
