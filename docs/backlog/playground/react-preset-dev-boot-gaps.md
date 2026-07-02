---
area: playground
status: draft
title: react-vite preset dev boot — config-wrapper bundling + dep pre-bundling gaps
created: 2026-07-02
why: the react-vite preset (first template with its own vite.config.ts + CJS browser deps) cannot reach LIVE — two loud runtime gaps block Vite 7 dev boot in-browser
user_story: As a playground user picking the React issue tracker, I want the preview LIVE like other presets, but today the vite CLI child fails config loading, and even past that the dep optimizer cannot pre-bundle CJS react
sources: [docs/backlog/playground/react-vite-preset.md, docs/adr/runtime-wasi/0047-revert-to-esbuild-wasi-forcing-consumer.md]
code: [apps/playground/src/workers/vite-cli-prep.ts, tools/shadow-registry/src/index.ts, apps/playground/src/workers/esbuild-wasi-transform.ts, apps/playground/src/templates/react-vite.ts, tests/e2e/react-vite-preset.spec.ts]
---

## Context

The react-vite preset is the FIRST template that (a) ships its own
`vite.config.ts` and (b) imports CJS-only npm deps (react/react-dom) into the
browser. Both hit pre-existing, deliberately-loud esbuild-shim ceilings that no
prior preset exercised. Chain verified 2026-07-02 (e2e + local shim-sim);
`tests/e2e/react-vite-preset.spec.ts` is the executable acceptance, marked
fixme on this item.

## Gap A — config-wrapper bundling breaks on a user vite.config.ts (hit first)

`vite` dev runs with `--config .rifty/vite-cli.config.mjs`; the wrapper imports
the user config via a RELATIVE specifier (`../vite.config.ts`). Vite's
`bundleConfigFile` "bundles" through the esbuild build-shim, which transforms
only the entry (documented no-traverse gap) — the relative import survives into
`node_modules/.vite-temp/vite-cli.config.mjs.timestamp-*.mjs`, where it
resolves to a dead path. Exact e2e failure:

```
failed to load config from /scratch/.rifty/vite-cli.config.mjs
ModuleLoadError: Cannot find module '../vite.config.ts'
  (imported from '/scratch/node_modules/.vite-temp/vite-cli.config.mjs.timestamp-….mjs')
```

`vite build` with a root `vite.config.js` works (no wrapper, no relative
import — `vite-command-honesty.spec.ts`). Fix direction per ADR-0047: route
`esbuild.build({bundle:true})` config bundling through the REAL WASI esbuild
CLI (`runWasi` already supports VFS preopens — see
`createEsbuildTransformBridge`) with `--bundle --packages=external`, instead of
the transform-only fake.

## Gap B — dep pre-bundling (esbuild.context) unimplemented; CJS react needs it

`@vitejs/plugin-react` injects `optimizeDeps.include: ['react', 'react-dom',
'react/jsx-runtime', 'react/jsx-dev-runtime']`; with a non-empty include the
Vite 7 optimizer runs at server startup and calls `esbuild.context` — the
build-shim loud-throws:

```
error when starting dev server:
NotImplementedError: Not implemented: esbuild.context
    at prepareEsbuildOptimizerRun (vite/dist/node/chunks/config.js)
```

(reproduced against real Vite 7.3.5 with the shim's surface; in rifty Gap A
fires first). Independently: react/react-dom (and `react-dom/client`, absent
from the include list) are CJS-only on npm — without pre-bundling Vite dev
serves them raw to the browser, which cannot execute them. So the optimizer
cannot be side-stepped by clearing `include`; CJS browser deps REQUIRE it.
Note: vite's optimizer drives `esbuildDepPlugin` (flat-id resolution, browser
fields, interop metadata from the metafile) — a CLI mapping must reproduce
that honestly or stay a loud throw; no silent approximation.

## Out of scope / loud today

- Both gaps throw loudly in the terminal today (fidelity holds; nothing lies).
- BrowserRouter deep links under the path-prefixed preview
  (`/preview/<port>/issues/3` → iframe pathname keeps the prefix, router
  basename '/'): a separate preview-model finding the e2e will surface once
  A+B land; keep it in this item's verification checklist.

## Acceptance (unblocks tests/e2e/react-vite-preset.spec.ts)

- `pickStarter('react-vite')` → `[vite] dev server ready on port 5174`, preview
  renders the dashboard from `src/data/issues.ts`.
- Remove the `test.fixme` gate; the spec passes in the chromium-heavy lane.
