---
area: playground
status: draft
title: `vite` dev path must not silently drop args / run unknown subcommands
created: 2026-06-26
why: DELIVERED 2026-06-26 via ADR-0174: the owner no longer parses `vite` args; the installed Vite CLI owns flags/help/version/unknown subcommands.
user_story: As a developer typing `vite --port 3000` in rifty, I want the port honored or a real CLI failure, never a silent fallback to the default dev server.
sources: [ADR-0173, ADR-0174, docs/backlog/playground/honest-vite-command-umbrella.md]
code: [apps/playground/src/workers/real-vite-bootstrap.ts, apps/playground/src/glue/bin-executor.ts, apps/playground/src/workers/node-entry-bootstrap.ts]
---

## Context

Before ADR-0174, the owner `registerCommand('vite')` callback classified only a
small subcommand set; dev-path args such as `vite --port 3000` could be dropped
or rejected by rifty instead of Vite. The interim classifier is gone.

Now `vite` resolves through `node_modules/.bin/vite`, so flags, help/version, and
unknown subcommands are handled by the installed CLI. The owner only observes
listened ports for UI state.

## Done Evidence

- `tests/e2e/vite-command-honesty.spec.ts` verifies `which vite` and `vite --help`.
- `apps/playground/src/workers/real-vite-bootstrap.test.ts` pins that no owner
  `vite` command is registered.

## Reversibility

IRREVERSIBLE decision recorded by ADR-0174. Reintroducing an owner Vite parser
requires a superseding ADR.
