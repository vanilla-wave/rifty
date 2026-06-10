# ADR 0105: xterm addon drop-ins

Status: Accepted (2026-06-09)
Date: 2026-06-09

> TL;DR: use official xterm addons for browser-native terminal affordances

## Context

Backlog asks for clickable URLs, in-terminal find, WebGL rendering with fallback, Unicode 11 output widths, inline images, and output export. These are xterm-owned rendering/interaction concerns; reimplementing them in rifty would duplicate upstream addon behavior.

## Decision

Add official `@xterm/addon-*` packages:

- `web-links` for Ctrl/Cmd-click URL handling;
- `search` for find-next/find-previous;
- `webgl` as best-effort renderer acceleration with DOM fallback;
- `unicode11` for output width tables;
- `image` for inline image protocols;
- `serialize` for HTML/text export.

Load addons inside `RiftyTerminal`; expose only small framework-neutral wrapper methods/options as needed.

## Consequences

- New external deps, but all from the xterm project and version-aligned with existing `@xterm/xterm`.
- WebGL remains best-effort; context loss falls back to DOM.
- Browser-only features stay no-op-safe in Node tests.

## Acceptance

- [x] Dependencies installed and lockfile updated.
- [x] Unit tests cover addon loading/fallback wrapper behavior.
- [x] `packages/terminal` typecheck passes.
