---
area: playground
status: draft
title: Umbrella — honest `vite` command (real CLI fidelity, no curated-shim drift)
created: 2026-06-26
why: DELIVERED 2026-06-26 via ADR-0174: `vite` now resolves to and runs the installed node_modules/.bin/vite CLI, not an owner-registered curated command.
user_story: As a developer running `vite ...` in rifty, I want the command to behave like the real Vite CLI — my vite.config applied, unknown flags not silently dropped, and the installed binary executing.
sources: [ADR-0148, ADR-0173, ADR-0174, ADR-0137, ADR-0150, ADR-0155, docs/backlog/playground/vite8-production-build-preview.md]
code: [apps/playground/src/workers/real-vite-bootstrap.ts, apps/playground/src/glue/bin-executor.ts, apps/playground/src/workers/owner-child-bin-executor.ts, apps/playground/src/workers/node-entry-bootstrap.ts, apps/playground/src/workers/vite-cli-prep.ts, apps/playground/src/workers/vite-config-guard.ts]
---

## Context

DELIVERED 2026-06-26: ADR-0174 removes `shell.registerCommand('vite')`. The
shell resolves `vite` through `node_modules/.bin/vite`; node-entry runs the
installed CLI with `bin:true`; the generic `.bin` child path is server-capable.
The owner observes child lifecycle messages to mirror dev/preview ports into the
UI, but it no longer parses Vite subcommands.

Before delivery, `vite` was an owner shell command that dispatched to curated
Vite Node-API helpers:

- bare `vite` / `vite dev` → `runDevServer`
- `vite build` → `runBuild(..., configFile:false)`
- `vite preview` → `runPreview`
- `vite optimize` / unsupported args → loud or interim diagnostics

That interim closed some silent gaps, but it was still not the real CLI. The
umbrella is complete only because the installed binary now executes end-to-end.

Public claim surface: `docs/public/compat/vite-command.md`.

## Decomposition

- `playground/honest-vite-dev-path-arg-honesty` — superseded by real CLI parsing.
- `playground/honest-vite-config-file-loading` — delivered for `vite` via real CLI;
  residual guard remains only for the legacy owner `npm run dev` Vite path.
- `playground/honest-vite-real-bin-dispatch` — delivered by ADR-0174.

## Reversibility

IRREVERSIBLE decision recorded by ADR-0174 (amends ADR-0148/0173 behavior):
`vite` is no longer an owner-curated command and must not be re-registered as one.
