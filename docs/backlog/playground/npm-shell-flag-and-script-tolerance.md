---
area: playground
status: ready
title: npm shell — tolerate `-D/--save` flags and alias `test/start` to `run`
created: 2026-06-30
why: a pasted-from-README `npm install -D x` hard-fails (`npm: flag '-D' not supported (M9 scope)`) even though `npm install x` works, and `npm test`/`npm start` 127-style fail with `unknown subcommand` — both read as an incomplete npm on the most reflexive post-install moves.
user_story: As a dev installing a package, I want `npm i -D vitest` and `npm test` to behave like real npm, but today the install path rejects ANY `-`-prefixed spec and the dispatcher only knows install/i/add + run.
epic: frictionless-first-poke
blocked_by: []
sources: [docs/backlog/epics/frictionless-first-poke.md]
code: [apps/playground/src/glue/npm-shell-command.ts]
---

## Context

`runInstall` rejects any spec starting with `-` before installing (`npm-shell-command.ts:306-310`); `pkg.devDependencies` is parsed (`:179`) but install only ever writes `dependencies[name]` (`:316`). The subcommand switch (`:88-101`) branches on `install/i/add` + `run/run-script` only → `npm test`/`start` → `npm: unknown subcommand 'test' (supported: install, i, add, run)`, unlike real npm which aliases them to `npm run test/start`.

## Acceptance

- `npm install -D <pkg>` / `--save-dev` → installs and records `<pkg>` under `devDependencies`; `-S/--save` (default), `-E/--save-exact`, and a bare install → `dependencies`. Save flags are otherwise no-ops.
- `npm i -g <pkg>` / `--global` → a DIRECTED `npm: global installs aren't supported in the browser sandbox — install into the project instead` exit 1 (named, not the generic "M9 scope" line).
- `npm test` / `npm start` / `npm stop` / `npm restart` → alias to `npm run <name>` (via the existing `runPackageScript`); a missing script keeps npm's faithful missing-script message + non-zero exit.
- The `unknown subcommand` message updates its `supported:` list to include the new aliases.

## Parity cases

- `npm i -D <pkg>` then read `package.json` → `<pkg>` under `devDependencies`, not `dependencies`.
- `npm i --save <pkg>` → identical result to bare `npm i <pkg>` (save is the default).
- `npm test` with a `test` script → runs it, exit code = the script's.
- `npm test` with no `test` script → npm's `Missing script: "test"`-shape message, non-zero exit.

## Out of scope

- `npm install -g` ACTUALLY installing a global bin (directed-throw only).
- `npm start`'s implicit `node server.js` default and `restart`'s pre/post-hook chain.
- Other subcommands (`init`, `ls`, `view`, `ci`, `uninstall`) — still `unknown subcommand` (named); separate playground follow-ups.

## Decisions

- `-D` → write the already-parsed `pkg.devDependencies`; partition argv into flags vs specs before the spec loop.
- REVERSIBLE (playground UX, no public API) → CHANGELOG in apps/playground; no ADR.
