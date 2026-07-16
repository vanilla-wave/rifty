# ADR 0275: Owner-applied project mutation stream

Status: Accepted
Date: 2026-07

> TL;DR: The owner records post-apply VFS revisions once; one Project VFS
> publisher delivers structural invalidation before reflected files and replies.

## Context

The owner VFS is mutated by Files, terminal commands, child processes, packages,
SCM, and archive/catalog operations. ADR-0273 currently invalidates Documents
only from the Files commit callback. The same rename or remove through another
owner path changes bytes and the Files snapshot but leaves an open document live
at a stale path.

Preflight mutation intents are not applied evidence. Snapshot diffs also cannot
distinguish rename from delete-plus-create, preserve partial-apply order, or
represent a reset. Calling page publication inline from an `FsSync` mutator
would let transport re-entry or failure interrupt ACK construction after bytes
changed. The mutation fact, publication order, and failure owner need one seam.

## Decision

`OwnerVfsAuthority` records every successful tree revision in an owner-private
pull journal. A record contains owner epoch, exact resulting tree revision, and
zero or more structural facts. Rename and remove facts are created only after
the raw operation and authority bookkeeping succeed. Writes, mkdir, copy,
metadata, and hidden claim changes still record the revision, with no structural
fact. No-op, failed CAS, failed raw operations, and replay create no new record.

The authority composition exposes a single-live-cursor capability, not the
journal writer. A cursor starts at the current revision, peeks ordered records,
acknowledges only after publication, waits without invoking external code from a
mutator, and drops retained records on close. Thus transport cannot re-enter a
mutation or erase applied evidence by throwing.

Root replacement uses an authority-owned structural-reset scope inside the
package mutation FIFO. Primitive records remain buffered while the scope is
active. If any tree revision applies, settlement publishes one `reset` fact at
the final applied revision; this also happens before rethrowing a partial
failure. A true no-op publishes nothing. Overlapping non-nested scopes reject.

`WorkbenchProjectVfs` is the only journal consumer and project-state publisher.
Its initial snapshot establishes the page baseline and consumes older records.
Afterward it filters facts to the active project and publishes one atomic state
frame containing:

1. all applied structural facts since the prior published revision;
2. a full project snapshot at the exact final revision.

The mutation source's terminal reply, when one exists, follows that state frame.
Atomic transport prevents re-entry from inserting an unannounced mutation
between invalidation evidence and its reflected snapshot.

The publisher also runs from journal wakeups, so direct owner mutations cannot
remain invisible. Mutation boundaries additionally await publication before a
Files ACK, child write reply, PTY exit, or companion mutation reply. They join
the same cursor; they never reconstruct semantics from their request.

The page validates epoch and monotonic revision order, applies structural facts
to Documents before updating the Files mirror, then lets reflection and
durability settle the initiating operation. Rename invalidates source and
target, remove invalidates its subtree, and reset invalidates the intersecting
project subtree. Multiple facts from one revision retain their recorded order.
An atomic document read or save already proven at revision N ignores delayed
facts at N; only a later revision can stale it. Duplicate, skipped,
foreign-project, or malformed evidence is a protocol failure, never a
best-effort update.

If applied-fact or snapshot delivery fails, the cursor remains unacknowledged
and the active project is fatally disconnected. An initiating Files operation
uses its retained owner ACK to report an applied failure when delivery still
works; otherwise owner exit leaves the outcome explicitly unknown. The session
never continues with live stale Documents. A future session starts from a new
snapshot rather than replaying a prior session's private journal.

## Consequences

- All owner mutation sources share one post-apply truth and ordering path.
- Files subscriptions include terminal/package/child writes, not only host CRUD.
- Structural meaning survives partial batches without guessing from snapshots.
- Publication is asynchronous; every observable mutation reply must join its
  project publication barrier.
- Delivery failure closes the project instead of preserving a stale live UI.
