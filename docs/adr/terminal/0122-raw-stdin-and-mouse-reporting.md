# ADR 0122: Raw stdin and mouse reporting

Status: Accepted
Date: 2026-06-10

> TL;DR: busy terminal input may flow to foreground stdin; mouse reports become bytes.

## Context

Mouse reporting is xterm-side protocol plus foreground raw stdin. `RiftyTerminal`
already received xterm data, but line-mode dropped non-Ctrl+C bytes while a
command was running. Shell commands also had no per-run stdin from the playground.

Need close the UX backlog item without claiming full Node TTY/raw-mode parity.

## Decision

- Add `TerminalRawInput = string | Uint8Array` and
  `RiftyTerminalOptions.onRawInput`.
- While `busy`, keep Ctrl+C as `SIGINT`; forward other `onData` payloads as
  strings to `onRawInput`.
- Forward xterm `onBinary` payloads as Latin-1 `Uint8Array`, preserving
  default/drag mouse protocol bytes beyond UTF-8 text.
- Add `RunOptions.stdin`; shell passes it to `ctx.stdin`.
- Playground owns a per-foreground-run stdin queue and routes terminal raw input
  to the active shell command only.
- Add `mouse-demo`: enables DECSET 1000+1006, reads one stdin chunk, disables
  modes, prints escaped bytes.
- Defer Node `process.stdin`, `tty.setRawMode`, literal ETX raw mode, and kernel
  worker TTY plumbing.

## Consequences

- DECSET 1000/1006 click path is browser-e2e-testable.
- Byte API avoids xterm `onBinary` corruption.
- Ctrl+C remains signal in this shell path.
- Mouse tracking can conflict with selection/link gestures while enabled.

## Acceptance

- [x] Terminal raw/onBinary forwarding tests.
- [x] Shell `RunOptions.stdin` and `mouse-demo` tests.
- [x] Playground stdin queue test.
- [x] Chromium e2e: click reaches `mouse-demo` stdin.
