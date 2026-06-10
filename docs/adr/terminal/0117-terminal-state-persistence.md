# ADR 0117: Terminal state persistence

Status: Accepted (2026-06-09)
Date: 2026-06-09

> TL;DR: persist shell cwd/env beside rich history

## Context

Backlog asks for terminal state persistence: history/cwd/env to OPFS. ADR-0116
stores rich history under `/workspace/.rifty`. Remaining state is shell cwd/env.
`Shell` owns mutable env internally but only exposes cwd.

## Decision

- Add `Shell.envSnapshot()` and `ShellSession.env()` as read-only copies.
- Persist `{ cwd, env }` as bounded JSON under `/workspace/.rifty`.
- Load/save terminal persistence through async OPFS when available; fall back to
  the session-only sync mirror when OPFS init fails.
- App loads state before constructing the shell session.
- App saves state after each terminal line, best-effort; command execution must
  not fail because persistence failed.

## Consequences

- Shell state survives reload when async OPFS is available.
- Env remains explicit shell state; no global process env mutation.
- Full project/session namespacing remains a follow-up.

## Acceptance

- [x] Store tests cover load/save/malformed state.
- [x] Shell/session tests cover env snapshots.
- [x] App wires persisted cwd/env at shell construction.
- [x] Backlog/changelogs record shipped scope.
