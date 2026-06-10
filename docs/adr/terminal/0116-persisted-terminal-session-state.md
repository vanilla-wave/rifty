# ADR 0116: Persisted terminal session state

Status: Accepted
Date: 2026-06-10

> TL;DR: persist rich history and cwd/env schema; validate cwd against workspace.

## Context

Users expect history search and cwd/env continuity. Playground needs persistence
through reload, but terminal package should own the reusable schema/helpers while
the app chooses storage.

## Options considered

- Session-only memory: simple, loses UX on reload.
- Playground-only schema: quick, not reusable by hosts.
- Chosen: package schema/load/save helpers plus playground OPFS/memory adapter.

## Decision

- Store rich records: command, cwd, mode, session id, start/end, duration, exit.
- Store cwd/env under `/workspace/.rifty` using terminal package helpers.
- Playground prefers async OPFS persistence with sync-mirror fallback.
- Restored cwd must exist as a directory in the active workspace VFS; otherwise
  default to `/workspace` while preserving env/history.

## Consequences

- Other hosts can reuse schema without Solid/playground imports.
- OPFS state cannot strand a fresh memory workspace in a stale cwd.

## Acceptance

- [x] Package history/state round-trip tests.
- [x] Playground persistence adapter tests including stale cwd fallback.
