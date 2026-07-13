---
area: terminal
status: draft
title: Umbrella — byte/PTY mode for interactive Node CLIs and TUIs
created: 2026-06-25
why: Raw stdin, EOF, resize, process ownership, and byte-stdio backpressure are tracked separately, but together they form one fidelity capability: interactive Node CLI/TUI support.
user_story: As a developer running an interactive Node program in rifty, I want terminal input/output to behave like a byte-oriented foreground process instead of a line-mode helper, but today the current pty channel is line/chunk/control-shaped and several raw-mode pieces are deferred.
sources: [ADR-0122, ADR-0146, ADR-0150, ADR-0225, ADR-0230, docs/public/compat/process.md, docs/backlog/terminal/raw-stdin-deferred-items.md, docs/backlog/terminal/ctrl-d-eof-line-discipline.md, docs/backlog/kernel/binary-stdio-messageport-backpressure.md]
code: [packages/terminal/src/terminal.ts, apps/playground/src/glue/pty-protocol.ts, apps/playground/src/glue/pty-client.ts, apps/playground/src/workers/pty-server.ts, packages/runtime-js/src/builtins/process.ts, packages/kernel/src/process-manager.ts]
---

## Context

This is an **umbrella item**. It does not replace the narrower backlog items; it
ties them together as one capability and gives future planning a single name.

The current playground pty channel is honest, useful, and already landed, but it
is not a raw-byte PTY. It is a structured `pty:*` protocol shaped around line
execution, stdout/stderr chunks, stdin frames, signals, exit frames, and
dev-server/preview control frames. That fits the current terminal shell model,
but it is not enough for interactive Node programs that expect terminal bytes and
TTY behaviour:

- `inquirer`/`prompts`/`blessed` need `setRawMode`, `isRaw`, key-by-key input,
  and literal control bytes in raw mode;
- real REPLs need Ctrl+D EOF behaviour;
- pipes and fast-producer/slow-consumer stdio need byte backpressure.

ADR-0225/0230 landed one owner PTY actor, flowing child stdin with explicit
host EOF, and live resize/SIGWINCH through a logical-disconnect-safe control
port. Real Chromium and Node OS-PTY parity cover that path. Raw line discipline,
Ctrl+D UX, and byte backpressure remain below.

This umbrella is about fidelity, not visual polish and not claiming POSIX PTY in
the browser. The goal is a browser-honest byte/TTY contract for reachable Node
programs; unsupported OS PTY semantics must remain explicit gaps.

Existing tracked pieces:

- `terminal/raw-stdin-deferred-items` — `tty.setRawMode`/`isRaw`, literal ETX
  raw mode, and foreground/process-group ownership.
- `terminal/ctrl-d-eof-line-discipline` — Ctrl+D as EOF on an empty line instead
  of unconditional forward-delete.
- `kernel/binary-stdio-messageport-backpressure` — raw-byte stdio with
  backpressure over process MessagePorts.
- `docs/public/compat/process.md` — flowing stdin is ⚠️; unsupported pull/raw
  surfaces remain loud.

## Options or Next

1. **Add raw-mode line discipline.** Implement `process.stdin.setRawMode()` /
   `isRaw` and the Ctrl+C policy switch: SIGINT in cooked/line mode, literal
   `\x03` in raw mode. Pin behaviour with parity-style tests around reachable
   Node APIs.

2. **Add Ctrl+D EOF.** Promote Ctrl+D-on-empty to EOF through the landed stdin
   seam; keep forward-delete for non-empty buffers. This likely needs an ADR
   because it changes current key contracts.

3. **Add byte stdio backpressure.** Move process stdio paths that need streaming
   away from unbounded JSON-ish message posting toward byte chunks with Writable
   `drain` semantics. Coordinate with shell pipes/input-redirection work.

4. **Finish compatibility claims.** Keep precise separate rows for flowing
   stdin, raw mode, Ctrl+D EOF, resize, and browser ceilings as each lands.

Readiness for this umbrella means a real interactive Node fixture can run in the
playground terminal, consume key-by-key stdin, toggle raw mode, receive EOF,
respond to resize, and exit/return control without silent hangs or fake success.

## Reversibility

REVERSIBLE as an umbrella backlog item. The child items remain the implementation
records. Behavioural changes such as raw-mode Ctrl+C, Ctrl+D EOF, foreground
ownership, or new pty wire frames may be IRREVERSIBLE under
`docs/process/decision-workflow.md` and need ADRs before merge.
