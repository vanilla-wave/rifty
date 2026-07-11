---
area: playground
status: draft
title: `vite` loads the user's real `vite.config.*`
created: 2026-06-26
why: DELIVERED 2026-06-26 via ADR-0174: `vite` runs the installed CLI, so Vite owns config discovery/loading instead of rifty hardcoding `configFile:false`.
user_story: As a developer with a vite.config.ts (an alias, a plugin, server.proxy), I want `vite` / `vite build` to apply it like real Vite.
sources: [ADR-0173, ADR-0137, docs/backlog/playground/honest-vite-command-umbrella.md]
code: [packages/workbench/src/workers/vite-cli-prep.ts, packages/workbench/src/workers/node-entry-bootstrap.ts, packages/workbench/src/workers/vite-config-guard.ts, packages/workbench/src/workers/build-boot.ts, packages/workbench/src/workers/dev-server-boot.ts, packages/workbench/src/workers/real-vite-bootstrap.ts]
---

## Context

DELIVERED 2026-06-26: `vite` / `vite build` now run the installed CLI, so
Vite's own config loading applies root `vite.config.*`. E2E coverage builds a
project with `vite.config.js` and verifies a config-defined marker in `dist/`.

Residual: the legacy owner Vite dev-server helper is still used by the current
`npm run dev` interception path. That helper keeps `assertNoUserViteConfig(root)`
and throws `NotImplementedError('vite.config-loading')` instead of silently
ignoring config.

The legacy curated helpers pass `configFile: false` + programmatic options derived from
`templateId`. Vite's real config resolution (`loadConfigFromFile`) esbuild-bundles
`vite.config.ts/js`, imports it through the module loader, merges `defineConfig`. None
of that runs there yet. Before the interim guard, a user-edited config was a no-op
with no signal.

## Residual

`npm run dev` still intercepts the dev script and boots the legacy owner Vite
helper. If that path remains, it must either be routed through real npm script
execution + `.bin/vite`, or keep loud-throwing on root config presence. It must
not silently ignore config.

## Done Evidence

- `tests/e2e/vite-command-honesty.spec.ts` writes `vite.config.js`, runs
  `vite build`, and verifies the configured marker in `dist/`.
- `packages/workbench/src/workers/vite-config-guard.test.ts` pins the residual
  loud-throw for the legacy owner path.

## Reversibility

IRREVERSIBLE for `vite` command behavior through ADR-0174. The `npm run dev`
residual is reversible cleanup.
