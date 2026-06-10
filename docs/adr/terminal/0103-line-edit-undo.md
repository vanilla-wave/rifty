# ADR 0103: Line edit undo

Status: Accepted (2026-06-09)
Date: 2026-06-09

> TL;DR: Ctrl+_ / Ctrl+Z undo line-editor mutations; redo deferred

## Context

Backlog asks for undo/redo. Redo bindings collide with browser/readline history-search keys; undo has stable readline keys (`Ctrl+_`, often `Ctrl+Z` when delivered by xterm).

## Decision

Add an editor-local undo stack. Capture snapshots before buffer mutations. `Ctrl+_` and delivered `Ctrl+Z` restore the previous buffer/cursor state. Redo remains deferred until a non-conflicting binding is chosen.

## Consequences

- Accidental edits are recoverable without changing host shell state.
- History navigation stays outside undo; it is recall, not text mutation.
- Redo remains unchecked in the feature backlog.

## Acceptance

- [x] Unit tests cover undo after insert and kill-ring edits.
- [x] `packages/terminal` typecheck passes.
