# ADR 0104: Tab completion seam

Status: Accepted (2026-06-09)
Date: 2026-06-09

> TL;DR: terminal owns UI; host owns completion sources

## Context

Backlog asks for tab completion over shell commands + VFS paths. `@riftydev/terminal` must not import shell/VFS. The playground composition root already owns the shell session and sync VFS.

## Decision

Add `RiftyTerminalOptions.completer(line, cursor)` returning a replacement range + items. `RiftyTerminal` applies unique matches, longest common prefix for multiple matches, and a simple text menu when no further prefix exists. Add `Shell.commandNames()` so the playground can complete commands without reaching into private maps.

## Consequences

- Terminal stays framework/shell agnostic.
- Playground can combine shell commands and VFS path entries.
- Rich dropdown completion can later reuse the same seam.

## Acceptance

- [x] Unit tests cover unique completion, LCP, and menu fallback.
- [x] Playground wires command/path completion.
- [x] `packages/terminal`, `packages/shell`, and `apps/playground` typechecks pass.
