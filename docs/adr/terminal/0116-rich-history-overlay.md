# ADR 0116: Rich history overlay

Status: Accepted (2026-06-09)
Date: 2026-06-09

> TL;DR: playground owns rich history overlay; terminal keeps fallback search

## Context

Backlog asks for Atuin-style rich history: Ctrl+R DOM overlay, rich records, OPFS
persistence. `RiftyTerminal` already has string history + xterm-rendered reverse
search (ADR-0097). Rich UI and persistence are playground concerns (D-002);
terminal should remain framework-agnostic.

## Decision

- Capture records at the playground `onLine` seam: command, mode, cwd, session id,
  start/end, duration, exit code.
- Persist bounded JSON under `/workspace/.rifty`; async OPFS store when
  available, session-only sync mirror fallback otherwise.
- `TerminalPanel` intercepts Ctrl/Cmd+R when rich records exist and renders a DOM
  overlay; empty/no-store falls back to terminal's built-in reverse search.
- Selecting a record calls `replaceLine(command)`; Enter/Tab apply, Esc closes.
- Keep old ArrowUp/Down/autosuggest history inside `RiftyTerminal` for line editing.

## Consequences

- Rich history survives reload when async OPFS is available; memory fallback is
  session-only.
- No xterm internals leak into Solid UI.
- Cross-project filtering and fuzzy scoring beyond substring remain follow-ups.

## Acceptance

- [x] Store tests cover load/save, truncation, search, metadata, malformed input.
- [x] Playground renders Ctrl+R overlay and applies selections.
- [x] Backlog/changelogs record shipped scope.
