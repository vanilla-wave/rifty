# ADR 0110: Wrapped-line cursor layout

Status: Accepted (2026-06-09)
Date: 2026-06-09

> TL;DR: edit repaint maps offsets to wrapped rows

## Context

ADR-0096 fixed display-cell width but explicitly deferred wrapped visual rows.
Long prompts still move with horizontal-only `\b` / `ESC[C`, so cursor restore,
history recall, and mid-line edits drift once `prompt + buffer` crosses `cols`.

## Decision

Add an internal prompt-relative layout model:

- keep `cursorPos` as JS string offset;
- map offsets to `{ row, col }` from prompt cells + display-cell width + `term.cols`;
- use row-aware cursor movement only when old/new input spans wrapped rows;
- repaint wrapped edits by clearing the visual input region, rewriting buffer,
  then restoring cursor;
- no public API change, no multiline validator, no syntax highlight yet.

## Consequences

- Wrapped long lines stop corrupting caret placement during core edits.
- Single-row byte echo stays stable for existing tests.
- Newline paste, syntax highlight, and dropdown anchoring remain follow-ups.

## Acceptance

- [x] Tests cover wrapped row movement, repaint, and history recall.
- [x] Existing single-row cursor/edit tests stay green.
- [x] Backlog/changelog record shipped scope.
