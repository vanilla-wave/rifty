---
area: runtime-js
status: parked
title: process/module/loader surface (emitWarning, --env-file, isBuiltin, SourceMap, stripTypeScriptTypes, data: import)
created: 2026-06-20
why: Self-contained process/module/loader methods absent — libs surface deprecations via emitWarning (gone → vanish/crash), bundlers externalize via module.isBuiltin, CLIs load env via --env-file; all pure-JS over existing EventEmitter/registry/VFS/loader.
user_story: As an author running a real-Node lib or CLI, I want emitWarning/--env-file/isBuiltin/SourceMap/data:-import to behave like Node, but today deprecation warnings vanish, --env-file is unparsed, isBuiltin is missing, and data: import hard-throws.
sources: [docs/research/node-parity-gaps-unbacklogged-2026-06-20.md §6, docs/adr/0026-*]
code: [packages/runtime-js/src/builtins/process.ts, packages/runtime-js/src/builtins/module.ts, packages/runtime-js/src/builtins/node-entry.ts, packages/runtime-js/src/module-loader/resolver.ts, packages/runtime-js/src/module-loader/source-maps.ts, packages/net/src/sqlite/engine.ts]
---

## Context

Self-contained process/module/loader methods absent. Each = pure-JS over existing primitives:

| feature (+since) | real path | anchor |
|---|---|---|
| `process.emitWarning(w[,opts])` v6 | build Warning, `emit('warning')`, format `(node:1) Warning:…`, dedupe; over EventEmitter+stderr | process.ts:86/103 |
| `process.loadEnvFile([p])` v20.12 + cli `--env-file`/`--env-file-if-exists` v20.6/v20.12 | shared dotenv parser over `syncMirror().readFileBytesSync`; cli needs argv/flag seam BEFORE loader.import (none today); `-if-exists` swallows ENOENT | node-entry.ts:60 |
| `process.getBuiltinModule(id)` v22.3 | wrapper over `loadBuiltin(id) ?? undefined` | builtins/index.ts:49 |
| `module.isBuiltin(name)` v16.17 | one-liner over `isBuiltinSpecifier` (strips `node:`); honest subset = registry-only | builtins/index.ts:47, module.ts |
| `module.SourceMap` + `findSourceMap(p)` v13.7 | surface class (`.payload`/`.findEntry`/`.findOrigin`) over `SourceMapRegistry`; subset = inline + per-loader, null untracked | source-maps.ts:40 |
| `process.setSourceMapsEnabled`/`sourceMapsEnabled`/`getSourceMapsSupport()` v16.6/v23 | module bool wired into withStackRemapping | source-maps.ts |
| `module.stripTypeScriptTypes` v22.13 (L) | sync pure-JS eraser (existing strip is ASYNC WASI esbuild); throw on enum/namespace unless transform | — |
| `data:` URL ESM import v12.10 | parse mediatype, `;base64`→atob else %-decode+TextDecoder, route executeEsm; no network | resolver.ts:129 |

REGRESSION TRAP — `getBuiltinModule`: `net/src/sqlite/engine.ts:48` + `engine-shimmed-process.test.ts` use its ABSENCE as the "not a real Node realm" signal; adding it breaks sqlite init. MUST refactor detection (e.g. `versions.rifty` marker) + update the pin FIRST, regression test first.

EXCLUDE `import.meta.resolve` — silent-wrong stub owned by runtime-js/silent-node-divergences (cross-link). `file://` import = separate sibling runtime-js/loader-file-url-resolution.

## Options or Next

Per-feature promotable; land each parity-first (failing parity test vs real Node, then implement). Order: emitWarning (S, isolated) → isBuiltin (S) → getBuiltinModule (gated on sqlite-detection refactor + pin update, regression test first) → loadEnvFile/--env-file (M, parser pinned + argv seam) → SourceMap/findSourceMap + sourceMaps toggles (M) → data: import (M) → stripTypeScriptTypes (L).

## Reversibility

REVERSIBLE — recorded here. getBuiltinModule's detection refactor touches a pinned cross-package contract; the marker choice (e.g. `versions.rifty`) is REVERSIBLE behavior-preserving but re-pin the test in the same change.
