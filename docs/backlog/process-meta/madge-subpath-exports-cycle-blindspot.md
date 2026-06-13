---
area: process-meta
status: active
title: check:deps (madge --circular) drops all @riftydev/* subpath-export imports, so cross-package cycles routed through a subpath are invisible to the only CI cycle guard
created: 2026-06-13
why: `pnpm check:deps` is the sole CI cycle guard but with no .madgerc and no tsconfig paths madge resolves only bare @riftydev/<pkg> -> src/index.ts and silently skips every package.json exports subpath (29 files skipped, 0 non-index cross-pkg edges in the graph), so a future cycle whose path crosses any subpath export would be acyclic to madge and pass CI undetected.
sources: [ADR-0018, ADR-0035, docs/backlog/process-meta/directional-layer-boundary-check.md]
code: [package.js, tools/refs/check.mjs, packages/vfs/package.js, packages/net/package.js, packages/runtime-js/package.js, packages/terminal/package.js, packages/kernel/package.js]
---

## Context

Repro verified: `npx madge --circular --warning --extensions ts,tsx packages/ apps/ tools/` -> 'No circular dependency found!' + 'Skipped 29 files' = the 21 distinct @riftydev/* subpaths (vfs/internal imported 34x incl. cross-pkg from runtime-js/runtime-wasi/shell; runtime-js/loader, net/registry, terminal/state, kernel/worker-entry, runtime-js/builtins/*). madge --json shows 167 cross-pkg edges all to src/index.ts, 0 to any non-index src file. Root cause: no .madgerc; tsconfig has no compilerOptions.paths; madge does not honor package.json exports. No live cycle exists today (name-level graph incl. subpaths = 0 cross-pkg cycles), so this is a guard-coverage gap. ADR-0035 explicitly relies on madge to catch a future net->io->...->net cycle. directional-layer-boundary-check.md is direction-only and assumes madge catches cycles.

## Options or Next

Make madge resolve subpath exports so cross-package edges are visible: (A) add a .madgerc with a tsconfig resolver + paths mapping each @riftydev/<pkg>/<sub> -> packages/<pkg>/src/<sub> (must enumerate every exports subpath and stay in sync — mitigate by generating the map). (B) Fold subpath resolution into the same custom zero-dep checker proposed in directional-layer-boundary-check.md (one scanner does direction + cycle incl. subpath edges) — preferred, no new dep, closes both gaps. Either way add a fixture cross-package cycle routed through a subpath export that must fail the check loudly.

## Reversibility

REVERSIBLE — backlog item; .madgerc/paths config or a custom zero-dep checker, no public API or behavior change. Co-locating with the direction checker avoids two overlapping CI scripts.
