# ADR 0108: Terminal viewport command header seam

Status: Accepted (2026-06-09)
Date: 2026-06-09

> TL;DR: expose viewport updates for command-header UI

## Context

Sticky command headers need the command block under the top viewport line.
`RiftyTerminal` already owns xterm markers, but playground UI must not import
xterm or read private fields.

## Decision

Add a small wrapper seam:

- `getViewportLine()` returns `buffer.active.viewportY`.
- `onViewportChange(line)` fires from xterm `onScroll`.
- `onCommandBlocksChange(blocks)` fires when recorded blocks change.

The playground computes the sticky header from public blocks + viewport line.

## Consequences

- Sticky UI stays in Solid; xterm stays inside `packages/terminal`.
- No polling.
- API is read-only; command block mutation remains terminal-owned.

## Acceptance

- [x] Unit tests cover viewport/block callbacks.
- [x] Playground sticky command header uses only public wrapper methods.
- [x] Typecheck passes.
