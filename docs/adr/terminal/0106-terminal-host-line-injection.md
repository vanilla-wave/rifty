# ADR 0106: Terminal host line injection

Status: Accepted (2026-06-09)
Date: 2026-06-09

> TL;DR: expose line-buffer injection for host overlays

## Context

Command palette, quick fixes, and snippets need to prefill or submit terminal
input from host UI. Direct xterm writes would desync `RiftyTerminal`'s private
line buffer/history/suggestions. Importing xterm into playground UI breaks the
wrapper boundary.

## Decision

Add framework-neutral `replaceLine(line)` and `submitLine(line?)` methods on
`RiftyTerminal`.

- `replaceLine` redraws current prompt buffer and focuses terminal.
- `submitLine` optionally replaces first, then runs the same Enter path as user
  input.
- Host overlays provide commands; terminal owns echo/history/execution state.

## Consequences

- Palette/quick-fix UI can stay in `apps/playground`.
- No xterm private access outside `packages/terminal`.
- Multiline injection remains deferred until wrapped-line editor work.

## Acceptance

- [x] Unit tests cover replace/submit line injection.
- [x] Playground command palette uses the public methods only.
- [x] Typecheck passes.
