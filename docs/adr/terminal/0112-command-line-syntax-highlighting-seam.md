# ADR 0112: Command-line syntax highlighting seam

Status: Accepted (2026-06-09)
Date: 2026-06-09

> TL;DR: terminal renders host-provided input highlight spans

## Context

Backlog asks for shell command-line syntax highlighting. Terminal cannot import
shell/playground code (layer rule), but it owns repaint/cursor math. ADR-0110
made wrapped repaint row-aware enough to render styled input without moving the
logical cursor by SGR bytes.

## Decision

Add `RiftyTerminalOptions.highlighter(line)`:

- returns offset-preserving spans `{ start, end, foreground }`;
- terminal renders the editable input buffer with SGR truecolor;
- `cursorPos` and submitted line stay raw string offsets;
- highlighter is host-owned; playground supplies a small shell lexer;
- no parser dependency, no shell import from terminal.

## Consequences

- Terminal keeps language-agnostic ownership of repaint.
- Shell-mode gets syntax color without corrupting command execution.
- Multiline validation and rich parse diagnostics remain follow-ups.

## Acceptance

- [x] Terminal tests cover highlighted input render and raw submitted line.
- [x] Cursor restore ignores SGR bytes during mid-line highlighted edits.
- [x] Playground tests cover shell command/string/operator spans.
- [x] Backlog/changelogs record shipped scope.
