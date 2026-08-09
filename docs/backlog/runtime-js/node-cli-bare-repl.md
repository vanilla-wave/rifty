---
area: runtime-js
status: draft
title: Bare Node CLI interactive REPL
created: 2026-07-30
why: Node opens an interactive REPL for a bare `node` attached to a TTY, while Rifty reports a missing entry and exits.
user_story: As a terminal user, I want a bare `node` command to open Node's interactive REPL, but today Rifty prints a non-Node missing-entry usage error.
sources: [M11, ADR-0155, docs/backlog/runtime-js/reference/node-v24.16.0-cli-eval-probe.md]
code: [packages/workbench/src/workers/node-entry-resolve.ts, packages/workbench/src/workers/workbench-project-runtime.ts, packages/runtime-js/src/repl/console.ts, packages/runtime-js/src/repl/inspect.ts, packages/runtime-js/src/builtins/misc-stubs.ts]
---

## Context

Node v24.16.0 with a TTY prints its versioned welcome, accepts expressions
under the `> ` prompt, preserves session state, and exits on `.exit`. Piped
stdin is a different stdin-script mode. The reproducible PTY command and exact
normalized transcript live in
`reference/node-v24.16.0-cli-eval-probe.md` §Residual CLI contexts.

Rifty currently classifies empty argv as a missing program. It writes
`node: missing entry file\nUsage: node <file> [args]\n`, exits 1, allocates no
child, and never consumes terminal input as a REPL. CommonJS `-e/-p` support
does not masquerade as this interactive context.

No matching title, `code:` owner, epic child, or bare Node CLI REPL item was
found on 2026-07-30. The PTY transcript supplies the user-action path. A
faithful contract must pin TTY versus piped-stdin selection, prompt/output
ordering, persistent bindings, dot commands, interrupts, EOF, errors, and
physical-child teardown. This draft chooses no REPL or terminal mechanism; no
coordination mechanism is proposed.
