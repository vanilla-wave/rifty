# Changelog

## [Unreleased]

### Added

- Cursor-aware line editing (ADR-0094, user-requested). The line editor tracks a
  caret (`cursorPos`) so you can move it and edit mid-line: ArrowLeft/Right move
  the caret (clamped at the line ends), Home/Ctrl+A jump to the start, End/Ctrl+E
  to the end, Delete (`\x1b[3~`) forward-deletes the char at the caret, Backspace
  deletes before it, and printable input inserts at the caret. Previously the
  editor was append-only and ArrowLeft/Right were swallowed (so `abc`,←,←,`X`
  yielded `abcX`; now `aXbc`). `keys.ts` classifies Home (`\x1b[H`/`\x1b[1~`/
  `\x1bOH`), End (`\x1b[F`/`\x1b[4~`/`\x1bOF`), Delete (`\x1b[3~`), Ctrl+A, Ctrl+E.
  History recall now clears the whole visible line even when the caret is mid-line
  and resets the caret to the end. Word-motion / kill-ring / reverse-search are
  intentionally out of scope.

- `RiftyTerminal` exposes `cols`/`rows` getters so the host can forward the live
  terminal size into the shell's `ctx.cols`/`ctx.rows` (drives `ls` column layout).
  Review pass 2026-06-07.

- `RiftyTerminal` wrapper over xterm.js: mount/dispose, `write`, `writeError` with ANSI red, line-based `onInput`, history (up/down).
- `applyAnsi`/`writeWithStream` helpers to colour stdout (default) and stderr (red).
- `RiftyTerminalOptions.onSignal('SIGINT')` callback so the host can route Ctrl+C to a kernel `processHandle.kill('SIGINT')` capability. The terminal still local-echoes `^C\r\n` itself before invoking the callback, matching kernel-TTY behaviour.
- `classifyKey(data)` helper in `keys.ts` exposing the byte→event mapping as a pure function — driven by unit tests for every key form (Enter, Backspace, Tab, arrows, Ctrl+C, multi-line paste, CSI-injection guard).
- `RiftyTerminal.handleInput(data)` is currently `public` (still the same code path xterm `onData` routes through) so unit tests can drive it without a DOM. Privatisation deferred — see A-041 (REVIEW_ACTIONS.md): swap to `private handleInput` + `onHandleInput?` option requires rewriting `terminal.test.ts`'s ~30 direct-call sites to await a callback, which is out of scope for the current "don't break the test suite" pass. Tracked for a dedicated test-rewrite session.

### Fixed

- Arrow keys and Ctrl+C: the byte literals in `handleData` were stored as raw bytes that an editor could easily strip on save. Replaced with explicit `\x1b[A`/`\x1b[B`/`\x1b[C`/`\x1b[D`/`\x03`/`\x7f` escape sequences via the pure `classifyKey` classifier. (Was a 🔴 silent stub per the 2026-05-25 review.)
- Ctrl+C is now processed even while `busy=true` — previously the busy guard at the top of `handleData` blocked ALL keystrokes including the very signal you need to interrupt the running command.
- Ctrl+C now emits a SIGINT signal via `onSignal` instead of only echoing `^C` locally.
- Multi-line paste (containing embedded `\n`) is now appended to the line buffer correctly. Previously the `charCodeAt(0) < 32` filter at the top of `handleData` dropped the entire paste because it started with a printable char but the filter only inspected the FIRST byte. Replaced with a per-byte whitelist (`\n`, `\r`, `\t` allowed; ESC sequences inside a paste are stripped wholesale to prevent CSI injection).
- `mount()` now lazily constructs `FitAddon` instead of eagerly in the constructor, so `RiftyTerminal` is constructible in a plain Node environment (the addon's IIFE references `self`).
