# ADR 0100: Command block metadata substrate

Status: Accepted
Date: 2026-06-10

> TL;DR: submitted commands become navigable/copyable blocks with exit status.

## Context

Terminal output is hard to scan after long commands. UX backlog asks for command
headers, block rail, block output selection/copy, and status without baking
Solid UI into `@riftydev/terminal`.

## Options considered

- Pure scrollback text: simple, no structured navigation.
- Playground-only parsing of prompt text: brittle and host-specific.
- Chosen: terminal records command markers/exit codes and exports selectors; UI
  stays host-owned.

## Decision

- `onInput` may return an exit code; terminal records command block start/end.
- Expose `TerminalCommandBlock`, block change callbacks, viewport line callbacks,
  `getViewportLine()`, `scrollToBlock()`, and `copyBlockOutput()`.
- Package exports pure command-block selectors for rail/sticky UI.
- Playground owns the visible rail/sticky header and copy button.

## Consequences

- Hosts can build IDE-like command navigation without parsing ANSI text.
- Exit status is optional/running until command completion.

## Acceptance

- [x] Command marker, nav, copy, and selector tests.
- [x] Playground uses package selectors for rail/sticky UI.
