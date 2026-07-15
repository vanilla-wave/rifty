# ADR 0230: Owner PTY stdin pump for supervised Node children

Status: Accepted
Date: 2026-07

> TL;DR: the owner PTY actor forwards ordered stdin data and explicit EOF into
> supervised Node and `.bin` children; pause/resume is real flow control, exit
> cancels the pump, and faults terminate the foreground command loudly.

## Context

Kernel `WorkerProcessHandle.stdin()` already writes a child `MessagePort`, and
runtime-js can seed `process.stdin` from it. The missing boundary is the owner
foreground executor: without one shared pump, a Workbench terminal can expose
`write()` while `node <file>` and package CLIs still reject or never receive
input. Implementing only the node executor would create sibling drift for
`.bin` commands.

EOF and flow control are observable Node behavior. Closing a stream must not
also destroy the resize/process-control transport.

## Decision

- `runForegroundChild` is the sole stdin pump for supervised Node and `.bin`
  children. The owner `PtySessionActor` supplies ordered data/EOF events.
- The pump reads one chunk, awaits the same child's stdin write, then reads the
  next. Source order is preserved and in-flight work is bounded.
- Explicit source EOF calls the child stdin stream's `end()` exactly once.
  Child exit stops the pump; a late read cannot write into a replacement run.
- Source/destination failure rejects the foreground command, terminates the
  child, and performs stdin/resize/signal/exit cleanup once. It never becomes a
  successful exit or an orphan input task.
- Seeded `process.stdin` implements flowing `data`, `setEncoding`, true
  `pause`, `resume`, and `end` behavior with split-UTF-8 decoder state.
  Unsupported pull/raw surfaces (`readable`, `read`, `pipe`, async iteration,
  `setRawMode`, byte backpressure/line discipline) remain loud
  `NotImplementedError` gaps.
- Logical IPC disconnect and stdin EOF close their logical channels only; the
  physical process-control channel remains until process exit.

## Consequences

- Node files and installed CLIs share one real terminal→owner→child input path.
- Node parity covers data ordering, pause/resume, split decoding, EOF, and exit;
  browser tests cover the real Workbench/worker boundary.
- This is faithful flowing non-TTY stdin, not a claim of full raw PTY support.
