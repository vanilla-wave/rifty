# ADR 0455: Bind process stdio identity for Readable.pipe

Status: Accepted
Date: 2026-09

> TL;DR: `Readable.pipe` reads the runtime-bound process stdio identity from `@riftydev/io`, never the guest-writable global.

## Context

ADR-0034 owns stream semantics. The Vitest pool pipes child output to its
process stdout/stderr. Node v24.16.0 exempts those destinations from `end()`.
Our first carrier read `globalThis.process` at `pipe()` time. A guest replacing
that global could exempt a foreign sink and end the real stdout/stderr. The
physical Node/Rifty RED and commands are in
`docs/backlog/runtime-js/reference/readable-pipe-never-ends-process-stdio-evidence.md`.

Node's internal process reference survives replacement of `globalThis.process`.
Changing the real process's `stdout` descriptor exempts the new sink and lets
the old stream end. A WeakSet of every constructed stdio writer would therefore
also misclassify stale streams.

## Decision

`@riftydev/io` owns the current process reference for `Readable.pipe`. Its
`setProcessStdioOwner(process)` integration API receives the runtime's existing
active bootstrap process whenever that binding changes. `pipe()` compares the
destination with that owner's live `stdout` and `stderr` identities. A captured
host process is the fallback when `@riftydev/io` runs standalone under Node.

Candidates: a `globalThis.process` lookup fails the forged-global RED; an
all-writers WeakSet fails Node's changed-descriptor probe; the active owner
matches both. `runtime-js` already owns process selection, so no new selector
or reverse `io` → `runtime-js` import is needed.

## Consequences

- Genuine process streams stay open under global replacement; foreign sinks
  still receive `end()`.
- The cross-package integration API is public; only the runtime bootstrap calls
  it during normal execution.
