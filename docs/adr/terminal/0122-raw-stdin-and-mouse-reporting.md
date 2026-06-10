# ADR 0122: Raw stdin and mouse reporting

Status: Accepted
Date: 2026-06-10

> TL;DR: busy terminal input reaches foreground shell stdin and runtime-js `process.stdin`.

## Context

Mouse reporting is xterm-side protocol plus foreground raw stdin. `RiftyTerminal`
received xterm bytes, but line-mode dropped non-Ctrl+C input while commands ran.
Shell commands also had no per-run stdin from playground. Follow-up UX review
found the same gap for runtime-js programs waiting on `process.stdin`.

## Options considered

- Keep dropping busy input: safe, no mouse/interactive demos.
- Wire only to playground shell stdin: smallest, but leaves JS programs unable
  to read interactive input.
- Wire terminal raw bytes into runtime-js `process.stdin`: needed for REPL and
  kernel-spawned JS processes; still keep Ctrl+C as signal/interrupt policy.
- Chosen: terminal forwards raw bytes; playground routes them to the foreground
  owner: active shell command in shell mode, runtime worker in REPL mode.

## Decision

- Add `TerminalRawInput = string | Uint8Array` and
  `RiftyTerminalOptions.onRawInput`.
- While busy, keep Ctrl+C as `SIGINT`; forward other `onData` payloads to
  `onRawInput`.
- Forward xterm `onBinary` payloads as Latin-1 `Uint8Array`.
- Add `RunOptions.stdin`; shell passes it to `ctx.stdin`.
- Playground owns a per-foreground-run stdin queue for shell mode and routes
  terminal raw input to the active shell command there.
- Add a runtime protocol `stdin` frame and `RuntimeController.writeStdin()` for
  REPL worker stdin.
- `runtime-js` `process.stdin` emits `data` chunks, supports `setEncoding('utf8')`,
  and buffers early stdin until a listener attaches.
- The kernel pre-entry `install-process` shim exposes `process.stdin` over
  `KernelProcessSpec.stdio.stdin`, matching the existing stdout/stderr ports.
- Playground registers optional `mouse-demo`, which enables DECSET 1000+1006,
  reads one stdin chunk, disables modes, and prints escaped bytes.
- Defer `tty.setRawMode`, literal ETX raw mode, and richer terminal process-group
  ownership to future backlog.

## Consequences

- DECSET 1000/1006 click path is browser-e2e-testable.
- Byte API avoids xterm `onBinary` corruption.
- Ctrl+C remains signal in this shell path.
- Runtime-js can run interactive REPL snippets and kernel-spawned JS processes
  that listen to `process.stdin.on('data', ...)`.
- `process.stdin` is chunk-oriented; terminal typing may arrive one key at a
  time, so line-oriented programs must accumulate until CR/LF.
- Mouse tracking can conflict with selection/link gestures while enabled.

## Acceptance

- [x] Terminal raw/onBinary forwarding tests.
- [x] Shell `RunOptions.stdin` and optional `mouse-demo` tests.
- [x] Playground stdin queue test.
- [x] Chromium e2e: click reaches `mouse-demo` stdin.
- [x] Runtime-js `process.stdin` unit tests for REPL worker and kernel process
  shim.
- [x] Chromium e2e: REPL snippet receives terminal input through `process.stdin`.
