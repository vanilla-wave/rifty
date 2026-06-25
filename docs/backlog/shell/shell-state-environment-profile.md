---
area: shell
status: active
title: Shell state and environment profile fidelity
created: 2026-06-25
why: cwd/env mutation is user-visible through owner-resident shell sessions, child processes, `npm run`, and PTY exit frames, but the model is spread across closures and snapshots.
user_story: As a developer running Node files and npm scripts in rifty, I want `PWD`, `OLDPWD`, `PATH`, `TERM`, `export`, `unset`, and npm lifecycle env to behave like a real shell/npm surface where supported, with explicit loud gaps where not supported.
sources: [Q-2026-06-25-shell-research, ADR-0146, ADR-0148, docs/backlog/shell/node-modules-bin-execution.md]
code: [packages/shell/src/shell.ts, packages/shell/src/commands/cd.ts, packages/shell/src/commands/env.ts, apps/playground/src/workers/pty-server.ts, apps/playground/src/glue/npm-shell-command.ts, apps/playground/src/workers/real-vite-bootstrap.ts]
---

## Context

The owner-resident shell makes cwd/env durable session state. Today `cd` mutates
cwd through an injected closure, bare `KEY=value` can persist env, fresh owner
shells may start with little baseline env, and npm scripts do not yet have a
faithful npm lifecycle environment.

This item is about the real process-observable environment, not terminal UI
polish. Child programs observe `process.env`; package scripts branch on these
values.

## Options or Next

1. Introduce a `ShellState` module for cwd/env mutation and snapshots.
2. Decide and test `PWD`/`OLDPWD` behaviour for `cd`, failed `cd`, and restored
   sessions against real shell/npm observations where relevant.
3. Add `export` and `unset`, or loud `NotImplementedError` entries plus compat
   rows if not implemented in the milestone.
4. Define an owner-owned `EnvironmentProfile` baseline: `HOME`, `PWD`, `PATH`,
   `TERM`, and any browser-honest values needed by reachable programs.
5. Define npm-run overlays such as `.bin` PATH prefix, `INIT_CWD`, lifecycle
   event values, and package metadata env only where verified.
6. Add shell unit tests and playground owner tests proving env survives PTY runs
   and reaches `node <file>`/npm scripts.

## Reversibility

Potentially IRREVERSIBLE if public environment behaviour changes. Record any
chosen `PWD`/`OLDPWD`, `PATH`, or npm lifecycle contract through the decision
workflow before treating it as compatibility.
