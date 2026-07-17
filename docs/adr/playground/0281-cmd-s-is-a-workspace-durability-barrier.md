# ADR 0281: Cmd+S is a workspace durability barrier

Status: Accepted
Date: 2026-07

> TL;DR: Cmd/Ctrl+S flushes pending editor writes, then the active owner, and
> reports success only after that owner's storage backend settles cleanly.

## Context

The App previously started `EditorApi.flushPendingWrites()` without awaiting it
and immediately displayed `Saved`. A user could then reload while admitted
editor or shell bytes were still queued for OPFS. The acknowledgement therefore
claimed more than it proved.

The choices are to keep the optimistic acknowledgement, expose persistence on
the public session-tools facade, or correlate one App-private durability
operation with the already captured owner.

## Decision

Cmd/Ctrl+S is a workspace barrier for the active project:

1. await the editor's pending-write drain;
2. send package-private `durability:flush` through the captured session-tools
   transport;
3. owner awaits Project VFS publication through its current revision, then
   `OwnerVfsAuthority.flush()`;
4. display `Saved` only after a clean correlated response.

The editor drain owns one exact model generation per path. A successful older
generation cannot clear a newer dirty edit; a failed debounced generation stays
eligible for the next explicit drain. Read-only and closed models are never
retry candidates. Save completion may report only while its captured project is
still active.

Flush exceptions and non-empty persistence failure reports return a normal
serialized owner error. The App displays `Save failed: ...` and never displays
`Saved` for that attempt. Failure samples map active-project paths to public
`/...` paths and redact paths outside the active project. The internal operation does not widen
`PlaygroundSessionTools`; persistence topology is not a public project tool.

On an ephemeral backend the barrier drains admitted in-memory work but does not
claim reload survival: the toast says `Saved for this session · EPHEMERAL` and
the existing `EPHEMERAL` affordance remains authoritative.

## Consequences

- `Saved` is usable as the public boundary before an immediate reload, including
  after a completed shell command.
- Save can wait for storage and can fail visibly instead of acknowledging early.
- Reload acceptance waits for `Saved`; it does not inspect private owner paths or
  treat reload itself as a persistence primitive.

## Correction 2026-07-16

ADR-0282 replaces the package-private call detail with public semantic
`PlaygroundSessionTools.awaitDurability()`. It returns no persistence report or
topology; editor drain, failure UI, and active-project correlation remain App
policy, and the barrier ordering above is unchanged.
