---
area: terminal
status: draft
title: Umbrella — byte/PTY mode for interactive Node CLIs and TUIs
created: 2026-06-25
why: Flowing stdin and live resize shipped in ADR-0230/0225, while raw stdin, EOF, process ownership, pull-mode reads, and byte-stdio backpressure remain one fidelity capability: interactive Node CLI/TUI support.
user_story: As a developer running an interactive Node program in rifty, I want terminal input/output to behave like a byte-oriented foreground process instead of a line-mode helper, but today the current pty channel is line/chunk/control-shaped and several raw-mode pieces are deferred.
sources: [ADR-0122, ADR-0146, ADR-0150, ADR-0225, ADR-0230, docs/public/compat/process.md, docs/backlog/terminal/raw-stdin-deferred-items.md, docs/backlog/terminal/ctrl-d-eof-line-discipline.md, docs/backlog/kernel/worker-per-process-residuals.md, docs/backlog/kernel/binary-stdio-messageport-backpressure.md]
code: [packages/terminal/src/terminal.ts, packages/workbench/src/glue/pty-protocol.ts, packages/workbench/src/glue/pty-client.ts, packages/workbench/src/workers/pty-server.ts, packages/runtime-js/src/builtins/process.ts, packages/kernel/src/process-manager.ts]
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

- `readline` and prompt libraries need `process.stdin` from the foreground child;
- `inquirer`/`prompts`/`blessed` need `setRawMode`, `isRaw`, key-by-key input,
  and literal control bytes in raw mode;
- real REPLs need Ctrl+D EOF behaviour;
- full-screen TUIs and pagers need raw input in addition to the delivered
  live-resize/SIGWINCH control plane (ADR-0225);
- pipes and fast-producer/slow-consumer stdio need byte backpressure.

This umbrella is about fidelity, not visual polish and not claiming POSIX PTY in
the browser. The goal is a browser-honest byte/TTY contract for reachable Node
programs; unsupported OS PTY semantics must remain explicit gaps.

Current slices:

- `terminal/raw-stdin-deferred-items` — `tty.setRawMode`/`isRaw`, literal ETX
  raw mode, and foreground/process-group ownership.
- `terminal/ctrl-d-eof-line-discipline` — Ctrl+D as EOF on an empty line instead
  of unconditional forward-delete.
- ADR-0225 — delivered run-scoped `pty:resize`, child TTY dimensions, stream
  `resize`, and process `SIGWINCH`.
- ADR-0230 — delivered ordered flowing non-TTY stdin for supervised Node and
  `.bin` children.
- `kernel/worker-per-process-residuals` — pull/pipe/async `process.stdin`
  behavior and generic browser conformance for SAB worker paths.
- `kernel/binary-stdio-messageport-backpressure` — raw-byte stdio with
  backpressure over process MessagePorts.
- `docs/public/compat/process.md` — flowing non-TTY stdin and live resize are
  ✅; pull/pipe/async/raw/EOF remain precise ❌ rows.

## Options or Next

1. **Define the foreground ownership model.** Decide which process owns terminal
   stdin, resize, signals, and raw/cooked state at any moment. This should clarify
   how shell line mode hands control to a foreground child and gets it back.

2. **Complete interactive stdin for `node <file>`.** Build pull/pipe/async and
   raw behavior on ADR-0230's real terminal→owner→child flowing pump. Keep loud
   throws for every still-unwired consume surface.

3. **Add raw-mode line discipline.** Implement `process.stdin.setRawMode()` /
   `isRaw` and the Ctrl+C policy switch: SIGINT in cooked/line mode, literal
   `\x03` in raw mode. Pin behaviour with parity-style tests around reachable
   Node APIs.

4. **Add EOF.** Promote Ctrl+D-on-empty to EOF through the same stdin ownership
   seam; keep forward-delete for non-empty buffers. This likely needs an ADR
   because it changes current key contracts.

5. **Add byte stdio backpressure.** Move process stdio paths that need streaming
   away from unbounded JSON-ish message posting toward byte chunks with Writable
   `drain` semantics. Coordinate with shell pipes/input-redirection work.

6. **Update compatibility claims.** Keep `docs/public/compat/process.md` precise
   as pull mode, raw mode, and EOF land; flowing stdin and live resize are
   already claimed separately.

Readiness for this umbrella means a real interactive Node fixture can run in the
playground terminal, consume key-by-key stdin, toggle raw mode, receive EOF,
respond to resize, and exit/return control without silent hangs or fake success.

## Reversibility

REVERSIBLE as an umbrella backlog item. The remaining child items stay the
implementation records. Behavioural changes such as raw-mode Ctrl+C, Ctrl+D
EOF, or foreground ownership may be IRREVERSIBLE under
`docs/process/decision-workflow.md` and need ADRs before merge.
