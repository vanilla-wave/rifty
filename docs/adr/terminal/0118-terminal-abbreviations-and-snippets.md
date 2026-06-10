# ADR 0118: Terminal abbreviations and snippets

Status: Accepted (2026-06-09)
Date: 2026-06-09

> TL;DR: host-provided line rewrites, terminal-owned trigger UX

## Context

Backlog asks for fish abbreviations/snippets. Terminal owns line editing; shell
owns command semantics. Need quick text expansion without shell-private parsing
or app-only hardcoding.

## Decision

- Add `TerminalRewriteRule` public option.
- Rule has `trigger`, `replacement`, optional `description`.
- Expand a trigger token when Space/Enter is typed and caret is at token end.
- Expansion is undoable; Enter submits the expanded line.
- Playground seeds shell-mode rules only; REPL stays plain.

## Consequences

- Fast aliases/snippets without new deps.
- Terminal still framework/shell agnostic.
- Placeholder navigation and user-editable rules remain follow-ups.

## Acceptance

- [x] Terminal tests cover Space/Enter expansion and undo.
- [x] Playground wires shell-mode rules.
- [x] Backlog/changelog record shipped scope.
