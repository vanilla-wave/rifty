# ADR 0264: Owner-acknowledged idle PTY dimensions

Status: Accepted
Date: 2026-07

> TL;DR: `PtySessionActor` owns terminal dimensions even while idle; a distinct
> `pty:session-resize` request/ACK makes `await terminal.resize()` truthful
> before `run()`, while ADR-0225's mandatory run-id fence stays unchanged for
> live resize.

## Context

ADR-0146 puts terminal sessions and shells in the owner. ADR-0225 adds
run-scoped `pty:resize { sid, rid, ... }`: the run id prevents a late resize
from reaching a replacement process. ADR-0263's Workbench example also calls
and awaits `shell.resize()` before `shell.run()`.

The existing wire cannot acknowledge that call: no run id exists. Remembering
the value on the page or resolving immediately would claim owner state that was
never committed. Waiting for a future run would deadlock the documented
`await resize(); run()` order. Making `rid` optional would weaken the live-run
fence and make idle versus active intent ambiguous.

The legacy page terminal manager contains the sibling fault: idle resize
returns a resolved promise without owner proof. Workbench migration must remove
that path rather than preserve it.

## Decision

- `PtySessionActor` owns current terminal dimensions for its full open
  lifetime, initially `80 × 24`; a run-local resize source may still be created
  and disposed per run.
- Keep ADR-0225's live frames unchanged and mandatory-rid:

  ```text
  pty:resize      { sid, rid, opId, cols, rows }
  pty:resize-ack  { sid, rid, opId, ok, error? }
  ```

- Add distinct idle-only frames:

  ```text
  pty:session-resize      { sid, opId, cols, rows }
  pty:session-resize-ack  { sid, opId, ok, error? }
  ```

- The actor accepts session resize only while open and idle. Positive ACK is
  sent only after committing both dimensions. Active returns
  `ProjectBusyError`; closing/closed/unknown returns `ClosedHandleError`;
  non-positive or non-safe-integer dimensions return `RangeError` without
  mutation.
- `pty:exec` remains clone-safe and carries dimensions. The actor validates and
  atomically seeds the run/current dimensions from them. A successful live
  resize first updates the child/source, then commits current dimensions, then
  ACKs. Failed live resize does not change the next run's acknowledged size.
- Sending `pty:exec` is not admission. After storing the active run and its
  completion state, the actor emits `pty:run-ready { sid, rid }`; only then may
  the page publish the run id or route controls. Re-entrant stop/close therefore
  targets a real owner run, never a sent-but-unowned id.
- Page/client port adds `resizeSession(sid, cols, rows)`; live
  `resize(sid, rid, cols, rows)` remains separate. Both validate before send
  and settle only the matching operation ACK.
- Public `ProjectTerminal.resize()` hides the branch. Idle calls wait for
  session open and owner ACK. A synchronous `run()` claim waits behind an
  already-admitted idle resize before sending exec; idle failure rejects the
  run without sending it. Once a run is claimed but not admitted, only the
  latest requested dimensions are sent after admission and all coalesced
  callers settle from that exact ACK. Live calls remain FIFO by ACK.
- Only positive owner ACK updates the dimensions used by a later exec. Pending
  intent is not state. Close/owner death rejects idle, pre-admission, and live
  waiters once; late ACKs are ignored.
- Remove the legacy idle `Promise.resolve()` sibling during Workbench migration.
  There is one dimension authority and no page-only success path.

## Consequences

- `await shell.resize(...); shell.run(...)` cannot deadlock or lie.
- Live resize retains ADR-0225's replacement-run fence and Node-visible
  `resize`/`SIGWINCH` behavior.
- The protocol gains one finite operation pair, one run-admission event, and
  client/actor state for matching ownership; it gains no generic extension.
- Protocol, client, actor, ProjectTerminal, and real client↔actor tests must
  cover validation, matching, ordering, failure, close/death, and next-run
  inheritance. Page-only fixtures do not close acceptance.
