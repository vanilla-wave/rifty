# ADR 0122: Raw stdin and mouse reporting

Status: Accepted
Date: 2026-06-10

> TL;DR: busy terminal input reaches foreground shell stdin; Node process stdin is backlog.

## Context

Mouse reporting is xterm-side protocol plus foreground raw stdin. `RiftyTerminal`
received xterm bytes, but line-mode dropped non-Ctrl+C input while commands ran.
Shell commands also had no per-run stdin from playground.

## Options considered

- Keep dropping busy input: safe, no mouse/interactive demos.
- Wire directly to runtime `process.stdin`: desired, but foreground process and
  kernel/runtime stdin contracts are not settled.
- Chosen: terminal forwards raw bytes; playground routes them to active shell
  command stdin; runtime stdin bridge is explicit backlog.

## Decision

- Add `TerminalRawInput = string | Uint8Array` and
  `RiftyTerminalOptions.onRawInput`.
- While busy, keep Ctrl+C as `SIGINT`; forward other `onData` payloads to
  `onRawInput`.
- Forward xterm `onBinary` payloads as Latin-1 `Uint8Array`.
- Add `RunOptions.stdin`; shell passes it to `ctx.stdin`.
- Playground owns a per-foreground-run stdin queue and routes terminal raw input
  to the active shell command only.
- Playground registers optional `mouse-demo`, which enables DECSET 1000+1006,
  reads one stdin chunk, disables modes, and prints escaped bytes.
- Defer Node `process.stdin`, `tty.setRawMode`, literal ETX raw mode, and kernel
  worker TTY plumbing to `docs/backlog/runtime-js/process-stdin-terminal-bridge.md`.

## Consequences

- DECSET 1000/1006 click path is browser-e2e-testable.
- Byte API avoids xterm `onBinary` corruption.
- Ctrl+C remains signal in this shell path.
- Mouse tracking can conflict with selection/link gestures while enabled.

## Acceptance

- [x] Terminal raw/onBinary forwarding tests.
- [x] Shell `RunOptions.stdin` and optional `mouse-demo` tests.
- [x] Playground stdin queue test.
- [x] Chromium e2e: click reaches `mouse-demo` stdin.
