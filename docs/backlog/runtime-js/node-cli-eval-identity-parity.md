---
area: runtime-js
status: draft
title: `node -e/-p` must use Node eval identity, not a temporary-file identity
created: 2026-07-15
why: The only Node CLI surface rejects `node -e/-p` outright, and the retired temp-file approximation it replaced had the wrong argv and module identity.
user_story: As a CLI author probing its invocation context under `node -e` or `node -p`, I want the same argv and module identity as Node 24, but today the terminal rejects the command.
sources: [M11, Node-v24.16.0-probe, ADR-0155, ADR-0157]
code: [packages/workbench/src/workers/workbench-project-runtime.ts, packages/workbench/src/workers/node-entry-bootstrap.ts, packages/runtime-js/src/builtins/node-entry.ts, packages/runtime-js/src/module-loader/cjs.ts]
---

## Context

Workbench is the only surface that parses `node` argv
(`node-entry-resolve.ts:45` `classifyNodeInvocation`); its `eval` kind throws
`NotImplementedError('workbench.node.eval-context')`
(`workbench-project-runtime.ts:335`). Honest, but it blocks the first-screen
Node CLI scenario. The legacy Playground path that ran a transient
`.rifty-eval-*.cjs` through `node <file>` is gone from production code — it
preserved loader execution but gave eval a file entry, added that path to
`process.argv`, registered the wrong module identity, and could leave workspace
bytes; `workbench-project-runtime.test.ts:939` pins that no such file appears.
Reviving it is out of scope, not an alternative.

## Readiness blocker

The pinned Node v24.16.0 oracle contradicts two assumptions in this ready
contract. `--eval=<source>` is an inline-source spelling, but
`--print=<source>` is not: Node treats `--print` as a boolean flag and obtains
source from the next argument. Node's `-p` writer also passes a top-level string
through without quotes (`node -p "'hello'"` prints `hello`), so it is not an
unconditional `util.inspect` call. The current runtime inspector additionally
cannot produce the already-required fulfilled-Promise and circular-reference
forms.

The contract must be recompiled from a reproducible Node v24.16.0 probe before
implementation. The pre-demotion `## Acceptance` and `## Parity cases` are
retained verbatim below.

## User scenario

A new user opens the Node CLI Starter and runs
`node -p "require('./package.json').name + ':' + process.argv.length" demo`,
then a package's documented `node -e` probe. The command must resolve relative
modules from the project, print the same value as Node v24.16.0, expose eval
identity rather than a generated workspace file, and return the real exit code.

## Acceptance

- Workbench dispatches `-e`/`--eval` and `-p`/`--print` to one eval-specific
  launch kind in the existing supervised Node child. The launch reuses the
  runtime-js CJS loader, process seeding, stdout/stderr, drain, signal, and exit
  machinery used by `node <file>`; it does not write a file or add a second
  evaluator.
- Differential cases run the same source, cwd, and script arguments against
  Node v24.16.0 and the Workbench terminal. No generated eval path exists
  before, during, or after the run; no `[eval]` module is inserted into
  `require.cache`.
- `tools/node-parity-runner/cases/process/node-eval-context.case.ts` pins the
  reference observables below. Workbench contract tests prove the launch payload
  and no-write boundary; a real Chromium first-15-minute e2e runs `node -e` and
  `node -p` from the Node CLI Starter.
- Only after all differential and Chromium proofs are GREEN may the
  `node -e/-p` compat row become ✅. A source grep or a fake child cannot close
  the item.

## Reference contract

- Oracle: Node v24.16.0, CommonJS eval mode.
- Mechanism: Node's eval-script CJS module context over the normal loader and
  process lifecycle; rifty reuses its existing CJS loader and supervised child.

## Parity cases

1. `-e`, `--eval`, `--eval=<source>`, `-p`, `--print`, and
   `--print=<source>` preserve source and every argument after it. `--` is
   consumed as the option terminator. For script args `alpha`, `two words`,
   `process.argv === [process.execPath, 'alpha', 'two words']`; no entry path is
   present and `process.argv0` retains the existing Node-process identity.
2. In CommonJS eval, `__filename === '[eval]'`, `__dirname === '.'`,
   `module.filename === resolve(cwd, '[eval]')`, `module.id === '[eval]'`,
   `module.parent === undefined`, `module.loaded === false` while source runs,
   and `require.main === undefined`.
3. `require('./relative.cjs')`, `require.resolve('./relative.cjs')`, and
   package lookup resolve from cwd. `module.paths` has the same cwd-anchored
   order as Node. Eval's synthetic module is absent from `require.cache`.
4. `-e` prints only user output. `-p` prints one Node `util.inspect` result
   after side effects: string, `undefined`, object/array, bigint, fulfilled
   Promise, and circular-reference cases match Node v24.16.0 formatting.
5. Normal completion, explicit `process.exit(N)`, rejected/throwing source,
   and syntax failure follow the existing supervised-child drain and exit
   contract. Error prelude and user frame name `[eval]:<line>:<column>`; no
   generated eval file (`.rifty-eval-*` or any other) and no project-absolute
   temporary filename leaks.
6. Two sequential and two concurrent eval children keep cwd, argv, module,
   stdout/stderr, exit, and preview scopes isolated; one child cannot become
   another's `require.main` or cache entry.

## Out of scope

- ESM eval via `--input-type=module` is a separate runtime context. Until it has
  its own parity contract, `node --input-type=module -e/-p` throws
  `NotImplementedError('workbench.node.eval-module-context')` and remains compat
  ❌; it never falls back to CommonJS.
- Preload/import flags `--require`/`-r` and `--import` are not added here. They
  retain explicit unsupported-option behavior and compat ❌; this item does not
  silently ignore them.
- The bare `node` REPL remains the ADR-0155 loud gap; eval support must not
  masquerade as an interactive REPL.
- Node-internal stack frames and the `Node.js vX` trailer are not synthesized;
  the exact `[eval]` user frame is in scope.

## Decisions

- Reuse the existing supervised Node child and runtime-js CJS loader with an
  internal eval-entry variant. No temporary workspace module, `data:` module,
  one-off `new Function`, new package API, or separate process lifecycle.
- One eval launch kind in the supervised child. A second evaluator — per-surface
  or a revived temp-file entry — is forbidden sibling drift.
- `-p` prints through the runtime's Node-compatible `util.inspect`, not JSON or
  browser console formatting.
- This is a reversible internal extension of ADR-0155/0157: public terminal
  spelling and process identity are already fixed; no new dependency or
  cross-package public API is introduced.
