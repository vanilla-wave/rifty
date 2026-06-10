# ADR 0096: Cell-width-aware terminal line editing

Status: Accepted (2026-06-09)
Date: 2026-06-09

> TL;DR: terminal edit math uses display-cell width, not JS string length; wrapped rows still deferred

## Context

ADR-0094 made `RiftyTerminal` cursor-aware, but echo math still assumes one JS code unit = one terminal cell. CJK, emoji, combining marks, tabs, and pasted text can desync the visible caret from `cursorPos`. The UX backlog names a cell-width cursor model as the foundation for CJK/emoji editing, syntax highlight, completion, and multiline.

## Decision

Add a small internal cell-width helper and route line-editor echo through it:

- Move by display cells for left/right, Home/End, mid-line repaint restore, and `replaceBuffer`.
- Treat combining marks as width 0, CJK/fullwidth and emoji-ish symbols as width 2, tab/newline as one edit unit for buffer indexing but rendered via existing xterm behavior.
- Keep `cursorPos` as a JS string offset for splice simplicity; convert offsets to cell counts at echo boundaries.
- No new dependency. No public API change.

Full wrapped-row editing is not part of this ADR. The helper removes the one-code-unit assumption and is the substrate for a later row/column layout model.

## Consequences

- Wide chars and emoji no longer move/erase as one cell during interactive edits.
- Combining marks stay attached visually when moving/erasing around accented text.
- Width table is intentionally compact, not Unicode-perfect; future `@xterm/addon-unicode11` may align output tables.
- Wrapped long lines still need a row/column repaint model before multiline, long completion menus, and syntax highlight are fully correct.

## Acceptance

- [x] Unit tests cover CJK/emoji move, insert, backspace/delete, Home/End, and history recall echo counts.
- [x] Existing ASCII cursor-aware tests stay green.
- [x] `packages/terminal/CHANGELOG.md` records the behavior change.
