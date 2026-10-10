---
area: runtime-js
status: draft
title: vite 8 `createServer({configFile, plugins})` never settles — the pipeline vitest's `createVitest` drives
created: 2026-10-05
why: with a config file AND at least one plugin, vite 8.0.16's `createServer` promise suspends forever in rifty (no handle, no rejection); this is the first wall `vitest run` hits after the CLI surface loads — `createVitest` never returns, no banner, silent drain exit 0
user_story: As a test runner in the browser shell, I want vite's programmatic server creation with my config and plugins to resolve like on my machine, but today the promise never settles and my process drains silently
epic: vitest-run-in-browser
blocked_by: []
sources: [docs/backlog/runtime-js/reference/vitest-config-pipeline-suspension-evidence.md]
code: []
---

## Context

Probes (Chromium e2e, 2026-10-05, exact pair installed via the overrides pin;
raw transcripts in the evidence file):

- `vitest --version` → `vitest/4.1.11 rifty-wasm node-v24.0.0`, exit 0.
- `vitest --help` → full CLI surface, exit 0.
- `vitest run` → NO output, natural drain exit 0 (rifty-diag: entry=returned,
  drain=resolved, ports=0).
- `node diag-probe.mjs`: `import('vitest/node')` → `createVitest('test',
  {watch:false})` suspends (no return, no rejection) for ANY config file —
  `vitest.config.ts`, and even a minimal `empty.config.ts` (`export default {}`),
  with both the default and `configLoader: 'bundle'`. With `config: false`
  `createVitest` RETURNS (and a later `close()` then suspends — second
  observation, same bucket).
- `import('vite')` → `vite.createServer({root})` (config auto-found) resolves;
  `vite.createServer({configFile: './empty.config.ts', plugins: [trivial
  plugin]})` SUSPENDS — no vitest involvement: a generic vite 8.0.16 wall at
  the configFile+plugins interaction.

Node 24 oracle: all probes resolve. Carrier, exact suspension site and handle
shape (never-settling promise vs missing keepalive ref) are the child's
diagnosis work; compile at PICKUP with a minimized vite-only repro.

Relation to the goal map: this is the re-chart the map's fog line predicted
("vite's TS-config loading is proven only for the 7.3.6/esbuild CLI path; the
8.0.16/rolldown config bundle and vitest's `.ts` transform are map fog — a
wall there enters this goal by re-chart"). The vitest-main keepalive open
question is RESOLVED as this named wall (not a Worker class gap).

## Challenge

challenge: 2026-10-05 — clear — discovered at u12 acceptance; probes above; entered the goal by re-chart (`RDY-5`)
