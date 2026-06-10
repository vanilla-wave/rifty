# ADR 0121: Background jobs

Status: Accepted
Date: 2026-06-10

> TL;DR: support transitional shell-level trailing `&`; real job control deferred.

## Context

Users expect `sleep 1 &`/dev-server-like background work, but kernel process
groups and terminal foreground ownership are not ready.

## Options considered

- Reject `&`: honest, poor terminal UX.
- Fake POSIX PIDs/job control: misleading without process groups.
- Chosen: shell-local background jobs with `jobs` listing and cooperative abort.

## Decision

- Only trailing `cmd &` is supported.
- Background jobs run through cloned shell state and stream output asynchronously.
- `jobs` lists shell-local id/status/command.
- Non-trailing `&`, pipes, and full job control remain loud unsupported paths.

## Consequences

- Better playground UX without claiming POSIX job control.
- Async output must not corrupt editable prompt repaint.

## Acceptance

- [x] Background start/list/status tests.
- [x] Async output prompt repaint tests.
