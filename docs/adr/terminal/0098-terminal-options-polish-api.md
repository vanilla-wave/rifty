# ADR 0098: Terminal options polish API

Status: Accepted
Date: 2026-06-10

> TL;DR: expose additive wrapper options, not raw xterm ownership.

## Context

Playground UX needs theme/font/cursor/a11y/clipboard polish, and hosts need a
small stable API without reaching into xterm internals.

## Options considered

- Expose raw `Terminal`: maximum power, leaks implementation and addon state.
- No polish API: keeps wrapper small, blocks host theming/accessibility.
- Chosen: additive `RiftyTerminalOptions` plus narrow methods.

## Decision

- Add options for theme, font family/size, cursor style, screen reader mode,
  contrast, copy-on-select, clipboard port, and macOS Option-as-Meta.
- Add `setTheme()` and `focus()` methods.
- Keep copy-on-select opt-in; Ctrl+C selection copy is line-editor policy
  covered by ADR-0097.

## Consequences

- Hosts can theme/accessibilize the terminal without xterm internals.
- Wrapper remains responsible for translating stable options to xterm.

## Acceptance

- [x] Options pass-through tests.
- [x] Clipboard-key tests.
