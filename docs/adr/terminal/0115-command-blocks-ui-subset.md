# ADR 0115: Command blocks UI subset

Status: Accepted (2026-06-09)
Date: 2026-06-09

> TL;DR: command blocks get a small DOM rail + block-copy wrapper

## Context

Backlog asks for VS Code-style command blocks: rail, ruler marks, nav, block-copy.
ADR-0100 already shipped markers, overview ruler marks, keyboard nav, and block
selection. ADR-0108 shipped sticky current-command UI. Missing surface: visible
block list/actions in playground, without importing xterm.

## Decision

- Keep block metadata terminal-owned (`TerminalCommandBlock`).
- Add `copyBlockOutput(id)` to `RiftyTerminal`; it selects the block and writes
  xterm's selection through the existing clipboard port.
- Playground renders a compact rail of recent blocks from `onCommandBlocksChange`.
- Rail click scrolls to a block; sticky header copy button copies current block.
- No Warp-style widgets or per-command output panes.

## Consequences

- Completes command-block UX atop ADR-0100 substrate.
- UI remains Solid-only; xterm stays wrapped.
- Exact block output extraction without selecting text remains follow-up.

## Acceptance

- [x] Terminal tests cover `copyBlockOutput`.
- [x] Playground helper tests cover current block + rail state.
- [x] Playground renders rail and sticky copy action.
- [x] Backlog/changelogs record shipped scope.
