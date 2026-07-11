# ADR 0230: Owner PTY stdin pump for supervised Node children

Status: Accepted
Date: 2026-07

> TL;DR: one foreground-child pump forwards the owner PTY's ordered stdin
> chunks into the existing kernel worker stdin port for both `node <file>` and
> `.bin` children; exit cancels the pump, EOF closes child stdin, transport
> faults terminate the child loudly, and unsupported raw/Readable surfaces stay
> `NotImplementedError`.

## Context

ADR-0224's public terminal controller promises attach/write/resize/dispose. A
real Chromium acceptance probe showed `TerminalController.write()` reached the
owner PTY queue, but a supervised `node <file>` child rejected
`process.stdin.setEncoding()` before the write: ADR-0155/0157 deliberately
installed a loud stdin guard because the owner never connected
`CommandContext.stdin` to the child.

Both ends now exist and are independently proven: kernel
`WorkerProcessHandle.stdin()` writes the child `MessagePort`, and runtime-js's
spec-seeded `process.stdin` consumes that port with ordered buffering and UTF-8
decoder state. The missing boundary is shared by the node and `.bin` executors,
which already converge in `runForegroundChild`. A node-only adapter would leave
the same observable contract drifting for package CLIs.

Completing the cross-realm pump changes Node-visible behavior and adds a
run-scoped lifecycle mechanism, so it is irreversible.

## Decision

- `runForegroundChild` is the sole stdin forwarding owner for supervised node
  and `.bin` children. When `CommandContext.stdin` exists it reads one chunk at
  a time and awaits the same worker handle's stdin write before reading the
  next, preserving source order and bounding in-flight work.
- Source EOF calls the child stdin stream's `end()`. Child exit stops the pump;
  a pending read may settle later but cannot write to the exited replacement.
- A source or destination failure rejects the foreground command, terminates
  the child, and runs exit/resize/signal cleanup exactly once. It never becomes
  a successful shell exit or an orphan input task.
- The seeded `process.stdin` enables its implemented flowing surface:
  `data` listeners, `setEncoding`, `resume`, and `pause`. The guard remains the
  single loud boundary for unsupported pull/stream/raw capabilities:
  `readable`, `read`, `pipe`, async iteration, and `setRawMode`.
- Observable proof is the public workbench Chromium path running a real Node
  file, waiting for its ready marker, writing through
  `TerminalController.write()`, and asserting echoed bytes plus exit 0. The
  existing Node parity case remains the oracle for split UTF-8 decoding.

## Consequences

- Embedders and the playground use one real input route for arbitrary Node
  files and installed CLIs; the controller no longer exposes a write method
  whose foreground consumer is intentionally disconnected.
- The shared pump prevents node/bin sibling drift and has one exit/EOF/error
  lifecycle rather than per-executor forwarding loops.
- This is chunked/cooked stdin, not a full byte PTY. `setRawMode`, literal ETX,
  Ctrl-D line discipline, pull-mode Readable APIs, and process-group ownership
  remain loud and tracked by the terminal stdin backlog items.
