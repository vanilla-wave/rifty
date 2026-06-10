# ADR 0098: Terminal options polish API

Status: Accepted (2026-06-09)
Date: 2026-06-09

> TL;DR: expose small xterm-backed polish knobs on `RiftyTerminalOptions`; keep defaults stable

## Context

The terminal UX backlog calls for theme/font options, light/dark readiness, `minimumContrastRatio`, screen-reader mode, cursor style, and copy-on-select. `RiftyTerminalOptions` is exported, so adding knobs is a public API change. xterm 5.5 already exposes these as stable options.

## Decision

Add additive options:

- `theme`, `fontFamily`, `fontSize`, `minimumContrastRatio`, `screenReaderMode`, `cursorStyle`.
- `copyOnSelect` and `clipboard` injection for best-effort clipboard writes.
- `setTheme(theme)` and `focus()` public methods.

Defaults preserve current visuals except `minimumContrastRatio` defaults to 4.5 for WCAG-AA protection. Clipboard writes are best-effort and never throw into terminal input.

## Consequences

- Playground and later light theme work can control terminal appearance without importing xterm.
- Tests can inject clipboard and inspect xterm constructor/options.
- Copy-on-select remains opt-in; Ctrl+C selection copy stays always-on from ADR-0097.
- No new dependency.

## Acceptance

- [x] Unit tests cover constructor options/defaults, `setTheme`, `focus`, and copy-on-select guard.
- [x] Existing Ctrl+C copy-vs-SIGINT behavior remains green.
- [x] `packages/terminal/CHANGELOG.md` records the API.
