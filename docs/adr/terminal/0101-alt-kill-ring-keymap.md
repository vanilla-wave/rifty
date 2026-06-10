# ADR 0101: Alt kill-ring keymap

Status: Accepted (2026-06-09)
Date: 2026-06-09

> TL;DR: expose xterm Option-as-Meta; add Alt-D/Alt-Backspace/Alt-Y editing

## Context

ADR-0097 shipped Ctrl-tier kill/yank (`Ctrl+U/K/W/Y`) but left Alt-tier readline keys. On macOS, xterm only emits Alt/meta sequences when `macOptionIsMeta` is enabled; rifty did not expose that option.

## Decision

Add `macOptionIsMeta?: boolean` to `RiftyTerminalOptions` and pass it to xterm. Classify:

- `Alt+D` → kill word right;
- `Alt+Backspace` → kill word left;
- `Alt+Y` → rotate the most recent yank through the kill ring.

No new dependency. Ctrl-tier behavior unchanged.

## Consequences

- macOS hosts can opt into Option-as-Meta without importing xterm.
- Kill-ring UX matches the backlog's Alt tier.
- Browser-reserved keys remain untouched.

## Acceptance

- [x] Unit tests cover key classification and edit behavior.
- [x] `packages/terminal` typecheck passes.
