# ADR 0104: Host assistance seams

Status: Accepted
Date: 2026-06-10

> TL;DR: terminal owns edit UI mechanics; host owns shell/project intelligence.

## Context

Completion, quick fixes, command palette, command-not-found suggestions, and
line injection need shell/project knowledge. Putting that in terminal would
violate layering; keeping it only in playground makes package hosts duplicate
logic.

## Options considered

- Terminal imports shell/playground knowledge: reverse dependency.
- Playground-only helpers: works for demo, weak package surface.
- Chosen: generic terminal seams plus `@riftydev/shell` language-service helpers.

## Decision

- Terminal exposes `completer(line,cursor)`, `onEditStateChange`,
  `replaceLine()`, and `submitLine()`.
- Shell exposes `commandNames()` and shell language-service helpers for
  completion/highlighting/input validation.
- Shell command-not-found suggestions remain in shell, preserving exit 127.
- Playground owns DOM autocomplete, command palette, and quick-fix rendering.

## Consequences

- Published packages can reproduce shell assistance without importing app glue.
- Terminal remains framework-free; Solid UI stays in playground.

## Acceptance

- [x] Terminal autocomplete reducer and line-injection tests.
- [x] Shell completion/highlighting/validator tests.
- [x] Playground imports assistance helpers from package APIs.
