---
area: shell
status: active
title: Unified command resolver and discovery interface
created: 2026-06-25
why: Running a command, `which`, completion, suggestions, direct path commands, and `.bin` lookup currently cross different seams and can disagree.
user_story: As a developer after installing a package or creating a script in the workspace, I want `vite`, `./node_modules/.bin/vite`, `./scripts/tool`, `which`, and completion to resolve consistently, but today those paths are split across shell execution, bin resolution, and language-service command names.
sources: [Q-2026-06-25-shell-research, ADR-0137, docs/public/compat/package-tooling.md]
code: [packages/shell/src/shell.ts, packages/shell/src/bin-resolver.ts, packages/shell/src/builtins.ts, packages/shell/src/language-service.ts]
---

## Context

ADR-0137 decided the bare command-name `.bin` resolution mechanism. The
remaining design problem is broader command discovery locality: execution,
`which`, completion, and suggestions should all ask the same resolver.

This item also covers direct path command execution such as
`./node_modules/.bin/vite` and `./scripts/tool`. That is distinct from PATH-style
bare `.bin` lookup and should still use the real bin/entry execution mechanism
where applicable.

## Options or Next

1. Add a `CommandResolver` interface with ordered results:
   registered builtin/custom command, direct executable path, `.bin` shim, miss.
2. Keep ADR-0137 precedence: registered commands shadow shims.
3. Make `which`, completion, suggestions, and execution use the resolver instead
   of duplicating command-name inventories.
4. Add tests for builtin shadowing, cwd changes, nearest ancestor `.bin`,
   path-like commands that contain `/`, and missing executable diagnostics.
5. Keep native host PATH execution out of scope; rifty commands execute from VFS
   and browser-owned runtime surfaces only.

## Reversibility

REVERSIBLE if resolver output is an internal module. New public command
resolution semantics or exported types need decision-workflow review.
