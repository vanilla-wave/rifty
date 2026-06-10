# ADR 0102: Line-mode bracketed paste policy

Status: Accepted (2026-06-09)
Date: 2026-06-09

> TL;DR: line-mode terminal strips bracketed paste wrappers

## Context

xterm can paste `\x1b[200~...\x1b[201~` when bracketed paste mode is active. rifty's terminal is line-mode, not raw TTY mode; wrappers would corrupt the edited command buffer.

## Decision

Set `ignoreBracketedPasteMode: true` in `RiftyTerminal`. Keep sanitizer coverage for pasted payloads that already include bracket wrappers.

## Consequences

- Browser paste and xterm `paste()` feed plain text into the editor.
- Raw bracketed paste support remains deferred until raw-stdin/TUI mode exists.
- No public option added.

## Acceptance

- [x] Unit tests cover wrapper stripping and xterm option default.
- [x] `packages/terminal` typecheck passes.
