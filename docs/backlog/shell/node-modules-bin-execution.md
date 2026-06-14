---
area: shell
status: active
title: Execute node_modules/.bin launcher shims by command name (PATH lookup)
created: 2026-06-12
why: install() now writes .bin launcher shims (PR #21 + review fix), but nothing in the shell resolves a bare `vite`/`tsc` to them — "installed CLIs invokable by name" is still NOT delivered; `npm run` relies on the host script runner special-casing commands
user_story: As a developer at the rifty shell prompt, I want to type a bare `vite`/`tsc` and run the installed CLI, but today the shell has no PATH-style walk-up to `node_modules/.bin/<name>` so the shims never get resolved.
sources: [M11, "npm-client/packagejson-driven-install-and-bin-linking (closed, PR #21)", ADR-0050]
code: [packages/shell/src/shell.ts, packages/npm-client/src/linker.ts]
---

## Context

The linker writes `node_modules/.bin/<command>` launcher shims
(`#!/usr/bin/env node` + `import('../<pkg>/<bin>')`) — the format is execution-ready, the
executor is missing. Shell command dispatch has no PATH-style lookup: `vite` at the prompt or
inside an `npm run` script line does not consult `.bin` of the cwd's nearest `node_modules`.

## Options or Next

- Command resolution order: builtins → walk-up `node_modules/.bin/<name>` → error. Execute the
  shim as a Node entry in the process Worker (shebang line already tolerated by the loader path
  used for `npm run`-spawned scripts — verify).
- `npm run` script lines get the project's `.bin` prepended to resolution (npm semantics).

## Reversibility

REVERSIBLE — shell-internal dispatch; shim format is already in the lockfile-replayed contract.
