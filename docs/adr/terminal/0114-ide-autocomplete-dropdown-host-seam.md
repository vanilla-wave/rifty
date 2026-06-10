# ADR 0114: IDE autocomplete dropdown host seam

Status: Accepted (2026-06-09)
Date: 2026-06-09

> TL;DR: playground owns DOM dropdown, terminal exposes edit state

## Context

Backlog asks for an IDE-style autocomplete dropdown built on tab completion.
`RiftyTerminal` already owns completion application, but DOM overlays belong in
`apps/playground` (D-002). Host needs current editable line/cursor and a way to
apply a selected range without reaching into terminal internals.

## Decision

Add host seams:

- `RiftyTerminalOptions.onEditStateChange({ line, cursor })`;
- `replaceLine(line, cursor?)`, clamped, redraws and focuses;
- playground intercepts Tab/Ctrl-Space when terminal has focus;
- playground calls the existing `completer`, renders a DOM list, and applies the
  selected range through `replaceLine`;
- terminal's built-in text completion menu remains fallback for other hosts.

## Consequences

- Core terminal stays framework-agnostic.
- Playground gets keyboardable autocomplete without printing suggestions into
  scrollback.
- Pixel-perfect caret anchoring and richer help remain follow-ups.

## Acceptance

- [x] Terminal tests cover edit-state notifications and cursor-aware `replaceLine`.
- [x] Playground glue tests cover dropdown creation and application.
- [x] Playground intercepts Tab/Ctrl-Space and renders keyboardable list.
- [x] Backlog/changelogs record shipped scope.
