---
area: shell
status: active
title: Shell command-file layout — commands/<cmd>.ts + _shared.ts + builtins.ts barrel
created: 2026-06-08
why: convention every new builtin depends on; a live TODO(backlog: shell/command-file-layout) marker points here at builtins.ts:1
sources: [Q-2026-06-07-407, adr/shell/0088-coreutils-pure-js-builtins-strategy.md]
code: [packages/shell/src/builtins.ts, packages/shell/src/commands/_shared.ts]
---

## Context

Each new builtin = its own `packages/shell/src/commands/<cmd>.ts` (`export const <cmd>: ShellCommand`), sharing `commands/_shared.ts` (resolve/enc/dec); `builtins.ts` is the registration barrel. Chosen for clean parallel fan-out (one file per builtin, no merge conflicts) over a monolithic `builtins.ts`.

## Options or Next

Cosmetic follow-up: the original ~9 builtins still live in `builtins.ts`, not yet relocated to `commands/`. Relocate when next touched.

## Reversibility

REVERSIBLE — file structure inside a package (always-reversible per CLAUDE.md); recorded because every builtin depends on the convention.
