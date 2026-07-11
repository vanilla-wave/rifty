---
area: playground
status: draft
title: `vite` runs the real `node_modules/.bin/vite` (retire the curated dispatch)
created: 2026-06-26
why: DELIVERED 2026-06-26 via ADR-0174: `shell.registerCommand('vite')` no longer shadows the installed binary; `vite` resolves through `.bin`.
user_story: As a developer, I want `which vite` → the installed shim and `vite` → the real CLI running, so Vite features/flags/config are owned by Vite, not rifty's curated parser.
sources: [ADR-0148, ADR-0173, ADR-0174, ADR-0137, ADR-0155, ADR-0150, docs/backlog/playground/honest-vite-command-umbrella.md]
code: [packages/workbench/src/workers/real-vite-bootstrap.ts, packages/workbench/src/glue/bin-executor.ts, packages/workbench/src/workers/owner-child-bin-executor.ts, packages/workbench/src/workers/node-entry-bootstrap.ts, packages/workbench/src/workers/vite-cli-prep.ts]
---

## Context

DELIVERED: the registered owner `vite` command and the curated Vite child wrapper
are gone. Shell resolution now reaches `node_modules/.bin/vite`; the owner
spawns that shim through node-entry with `RIFTY_BIN=1`, `RIFTY_REMOTE_FS=1`,
`RIFTY_NODE_SERVE=1`, and `serve:true`.

Vite dev/preview remain integrated with the playground by observation only:
when the real CLI listens, node-entry posts the listened port and the owner
mirrors it into `pty:dev-server` / preview registry state.

## Done Evidence

- `which vite` resolves to `/scratch/node_modules/.bin/vite` in e2e.
- `vite --help` is printed by the installed CLI.
- `vite build` loads root `vite.config.js` and emits a config-defined marker into
  `dist/`.
- Unit seams pin server-capable `.bin` spawn specs, child message forwarding, and
  the absence of `shell.registerCommand('vite')`.

## Reversibility

IRREVERSIBLE decision recorded by ADR-0174. Re-registering a curated owner
`vite` command would violate this item and must go through a superseding ADR.
