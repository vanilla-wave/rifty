# ADR 0119: Inline image producer command

Status: Accepted (2026-06-09)
Date: 2026-06-09

> TL;DR: `img` emits a tiny inline PNG demo

## Context

ADR-0105 loads `@xterm/addon-image`. Backlog still needs a producer so users can
see inline-image output without external files or native tools.

## Decision

- Add shell builtin `img`.
- TTY only: emit iTerm inline image protocol with embedded 1x1 PNG.
- Non-TTY: print nothing, exit 0.
- No filename/file download/user-file rendering in this cut.

## Consequences

- Proves terminal image path end-to-end.
- No new deps or VFS reads.
- Real file/image utilities remain follow-ups.

## Acceptance

- [x] Unit tests cover TTY/non-TTY output.
- [x] `img` registered as builtin.
- [x] Backlog/changelogs record shipped scope.
