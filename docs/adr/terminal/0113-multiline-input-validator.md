# ADR 0113: Multiline input validator

Status: Accepted (2026-06-09)
Date: 2026-06-09

> TL;DR: Enter can insert newline until host says input complete

## Context

Backlog asks for multiline editing with an input validator. `RiftyTerminal`
already stores pasted `\n` in the buffer, and ADR-0110/0112 made full repaint
row-aware enough to redraw multi-row input. Enter still always submits.

## Decision

Add `RiftyTerminalOptions.inputValidator(line, cursor)`:

- returns `'complete'` or `'incomplete'`;
- Enter submits when complete or when no validator is present;
- Enter inserts `\n` at the caret when incomplete;
- inserted newline is a normal undoable edit;
- terminal stays language-agnostic; playground supplies shell-mode validation.

## Consequences

- Existing single-line callers keep byte-stable Enter behavior.
- Hosts can implement bracket/quote-aware multiline policies.
- Fancy continuation prompts and syntax diagnostics remain follow-ups.

## Acceptance

- [x] Tests cover incomplete Enter newline insertion and later raw multiline submit.
- [x] Undo covers validator-inserted newline.
- [x] Playground shell validator covers unterminated quotes / brackets.
- [x] Backlog/changelogs record shipped scope.
