# ADR 0107: Line edit redo

Status: Accepted (2026-06-09)
Date: 2026-06-09

> TL;DR: redo line edits via a browser-key handler

## Context

ADR-0103 added undo on Ctrl+_ / delivered Ctrl+Z. Redo was deferred because
terminal byte streams collide: Ctrl+Z and Ctrl+Shift+Z can arrive as the same
SUB byte after xterm/browser handling.

## Decision

Keep redo as editor state in `RiftyTerminal`, but bind it through xterm's
custom DOM key handler:

- Ctrl/Cmd+Shift+Z invokes redo and prevents browser undo/redo.
- Undo pushes current state to a redo stack.
- Any new edit clears the redo stack.
- Enter / Ctrl+C clear undo + redo.

## Consequences

- No ambiguous `onData` byte parsing.
- Browser-only key binding; tests cover the pure key classifier and stack logic.
- Redo remains line-mode only; multiline redo waits for wrapped-line editor work.

## Acceptance

- [x] Unit tests cover redo key classification and stack behavior.
- [x] `packages/terminal` typecheck passes.
