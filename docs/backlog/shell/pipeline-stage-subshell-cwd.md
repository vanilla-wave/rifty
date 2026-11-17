---
area: shell
status: draft
title: A `cd` in a pipeline stage leaves the shell cwd unchanged, as in bash
created: 2026-11-17
why: `cd d | cat` changes the rifty shell cwd; a bash pipeline stage is a subshell
sources: [packages/shell/fixtures/bash/command-lists-bash-3.2.57.json, docs/public/compat/shell.md]
code: [packages/shell/src/shell.ts, packages/shell/src/commands/cd.ts]
---

## Context

GNU bash 3.2.57 (macOS 26.6.2, `/bin/bash --noprofile --norc -c`) vs rifty
`Shell.run` @ 1f61b7bc5 (MemoryFsSync cwd `/p`), 2026-11-17:
`mkdir d; cd d | cat; pwd` → bash prints the original cwd, rifty `/p/d`
(silent; persists into later commands of a COI terminal session).

Since 2026-11-17 an assignment-only pipeline stage no longer persists
(`assign-pipeline-subshell` in the frozen bash fixture); stages still run in
the shell itself, so `cd` (and any other shell-state builtin) does.
