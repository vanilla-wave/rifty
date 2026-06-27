---
area: shell
status: draft
title: Explicit shell-script support surface
created: 2026-06-25
why: Backlog tracks shell primitives, but not the user-facing script workflows: `sh -c`, executable `.sh`, shebang shell scripts, and npm package scripts that are shell programs.
user_story: As a developer running package scripts in rifty, I want supported shell scripts to run faithfully and unsupported shell grammar to fail loudly, rather than a partial parser silently accepting script text it cannot execute like real shell.
sources: [Q-2026-06-25-shell-research, ADR-0146, ADR-0148, docs/public/compat/package-tooling.md, docs/backlog/shell/pipes.md, docs/backlog/shell/parameter-expansion.md, docs/backlog/shell/command-substitution.md]
code: [packages/shell/src/builtins.ts, packages/shell/src/tokenize.ts, apps/playground/src/workers/real-vite-bootstrap.ts, apps/playground/src/glue/npm-shell-command.ts]
---

## Context

The project already tracks primitives such as pipes, input redirects, parameter
expansion, and command substitution. Users encounter a higher-level workflow,
though: package scripts and `.sh` files. Those must not get silent partial shell
semantics.

The first useful version may be staged and narrow: run npm script command lines
through the rifty shell where the grammar is supported; loudly reject unsupported
script grammar with stable `NotImplementedError('shell.script.*')` names and
compat rows. A future real WASI shell or other implementation would need a
separate decision.

## Options or Next

1. Define the supported shell-script entry surfaces: `sh -c`, executable `.sh`,
   shebang shell scripts, and npm script command strings.
2. Decide which surfaces are in scope for the next milestone and which stay loud
   gaps.
3. Route supported npm script commands through the shell resolver without
   claiming full POSIX shell semantics.
4. Add fixtures for supported grammar and loud rejection tests for unsupported
   grammar.
5. If considering a real shell implementation dependency or WASI applet, run the
   decision workflow before adding it.

## Reversibility

Potentially IRREVERSIBLE if public script execution semantics are exposed.
Unsupported script surfaces should remain loud until the chosen behaviour is
tested and documented.
