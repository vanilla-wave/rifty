---
area: runtime-js
status: active
title: Foreground process stdin bridge from terminal
created: 2026-06-10
why: Raw terminal bytes currently reach playground shell commands, not Node process.stdin.
sources: [docs/adr/terminal/0122-raw-stdin-and-mouse-reporting.md]
code: [packages/runtime-js/src/builtins/process.ts, apps/playground/src/adapters/shell-adapter.ts]
---

## Context

`RiftyTerminal.onRawInput` feeds the playground shell's per-run stdin queue.
That covers shell builtins such as the optional `mouse-demo` command, but not
Node programs running through `runtime-js`: `process.stdin` is still not wired
to the active terminal foreground process.

## Options or Next

- Add a runtime protocol stdin frame and `RuntimeController.writeStdin`, then
  route terminal foreground bytes to the active runtime process.
- Or route through kernel `ProcessHandle.stdin()` once worker-per-process stdin
  ownership is settled.

Either path needs explicit foreground ownership, EOF/close behavior, Ctrl+C vs
literal ETX policy, and tests for `process.stdin` readable semantics.

## Reversibility

IRREVERSIBLE once public runtime/process stdin API ships; backlog until the
foreground process contract is designed.
