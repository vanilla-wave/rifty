---
area: runtime-js
status: draft
title: `node -` and bare `node` with non-TTY stdin run the program read from stdin
created: 2026-11-17
why: Node 24 runs stdin as the program for `node -` and for a bare `node` whose stdin is not a TTY; rifty reports `node: bad option: -` (exit 9) and a missing-entry usage error (exit 1)
user_story: As an agent or script author, I want `echo 'console.log(1+1)' | node -` to print `2`, but today rifty rejects `-` as a bad option
sources: [docs/backlog/runtime-js/node-cli-bare-repl.md, docs/backlog/shell/heredoc.md]
code: [packages/workbench/src/workers/node-entry-resolve.ts, packages/workbench/src/workers/no-coi-project-command.ts, packages/workbench/src/workers/workbench-project-runtime.ts]
---

## Context

Oracle, Node v24.16.0 on macOS 26.6.2, 2026-11-17:

```console
$ echo 'console.log(1+1)' | node -; echo "exit=$?"
2
exit=0
$ echo 'console.log(1+1)' | node; echo "exit=$?"
2
exit=0
```

Rifty: `classifyNodeInvocation` (`node-entry-resolve.ts`) returns `badOption`
for any leading `-` arg, so `node -` prints `node: bad option: -` and exits 9;
an empty argv is `missing` (`node: missing entry file`, exit 1) regardless of
stdin. Reached today by `cmd | node -` and, after `shell/heredoc`, by
`node - <<'EOF'` (8 of 20 agent heredocs in the 2026-11-12 no-COI office
trials). The TTY case is the REPL: `runtime-js/node-cli-bare-repl`.

At pickup: Node's stdin-program identity (`__filename` `[stdin]`, CommonJS vs
`--input-type`, `process.argv`), EOF/read errors, and both COI and no-COI
command paths need a parity case each.
