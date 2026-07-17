---
area: runtime-js
status: draft
title: `node -e/-p` must use Node eval identity, not a temporary-file identity
created: 2026-07-15
why: The terminal implements eval by running a transient `.cjs`, changing observable argv and module identity from Node 24.
user_story: As a CLI author probing its invocation context under `node -e` or `node -p`, I want the same argv and module identity as Node 24, but today rifty exposes a temporary entry file.
sources: [Node-v24.16.0-probe, ADR-0155]
code: [apps/playground/src/workers/real-vite-bootstrap.ts, apps/playground/src/workers/workbench-project-runtime.ts, apps/playground/src/workers/node-entry-bootstrap.ts, packages/runtime-js/src/builtins/node-entry.ts, packages/runtime-js/src/module-loader/cjs.ts]
---

## Context

The legacy Playground owner (`real-vite-bootstrap.ts`) writes a transient
`.rifty-eval-*.cjs`, then executes it through the ordinary `node <file>` child
path. That preserves real loader execution but silently gives eval a file entry
and puts that path in `process.argv`. The Workbench owner refuses this model
with `NotImplementedError('workbench.node.eval-context')`.

Node v24.16.0 instead reports `process.argv` as `[execPath, ...scriptArgs]`,
`__filename === '[eval]'`, `__dirname === '.'`,
`module.filename === resolve(cwd, '[eval]')`, `module.id === '[eval]'`, and
`require.main === undefined` for both `-e` and `-p`. Refine this into one parity
contract covering argv indices, filename / dirname, module fields,
`require.main`, relative `require()`, print formatting, and thrown-error
filenames before implementing an eval-specific runtime seam.

Until that contract is GREEN, the legacy path remains ⚠️ and Workbench remains
❌ in the compat matrix; neither may claim Node-compatible `-e/-p`.
