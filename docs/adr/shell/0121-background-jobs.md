# ADR 0121: Background jobs

Status: Accepted (2026-06-09)
Date: 2026-06-09

> TL;DR: `cmd &` starts shell-level job, prompt returns

## Context

Terminal UX backlog asks for background blocks. Kernel process job control is
not ready, but shell commands are async, cancellable, and already stream output.
Need useful browser terminal UX without fake PIDs or silent drops.

## Decision

- Implement transitional shell jobs, not OS/kernel processes.
- Trailing `cmd &` starts a cloned `Shell` with cwd/env snapshot and registered
  custom commands, then returns prompt immediately.
- Parent shell owns job id/status table; `jobs` lists `Running`, `Done`, or
  `Exit N`.
- Background output streams through existing `onChunk`; completion emits job
  status.
- `dispose()` aborts running jobs. Foreground SIGINT does not kill background
  jobs.
- `|`, `<`, and nested/non-trailing `&` stay loud `NotImplementedError`.
- Terminal `write()` protects editable input by clearing/redrawing prompt around
  async output.

## Consequences

- Useful `sleep 1 &`, dev-server-style command UX without blocking prompt.
- No fake PID/fg/bg. Kernel process jobs remain later.
- Background `cd` cannot mutate parent cwd.
- High-volume output/backpressure and full TTY job control remain follow-ups.

## Acceptance

- [x] Shell tests cover start, jobs table, cwd isolation, unsupported pipes,
  dispose abort.
- [x] Terminal tests cover async output while editing.
- [x] Backlog/changelogs record shipped scope.
