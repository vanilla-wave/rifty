---
area: runtime-js
status: draft
title: process/module/loader gaps (warning files, --env-file, SourceMap, stripTypeScriptTypes, data import)
created: 2026-06-20
why: Warning-file output, env-file loading and loader/source-map APIs remain incomplete over existing process/VFS/loader primitives.
user_story: As a Node CLI author, I want warning files, env-file loading and loader APIs to behave like Node, but those paths still have explicit gaps.
sources: [docs/research/node-parity-gaps-unbacklogged-2026-06-20.md §6, docs/adr/runtime-js/0026-*]
code: [packages/runtime-js/src/builtins/process.ts, packages/runtime-js/src/builtins/module.ts, packages/runtime-js/src/builtins/node-entry.ts, packages/runtime-js/src/module-loader/resolver.ts, packages/runtime-js/src/module-loader/source-maps.ts, packages/net/src/sqlite/engine.ts]
---

## Context

Self-contained process/module/loader methods absent. Each = pure-JS over existing primitives:

| feature (+since) | real path | anchor |
|---|---|---|
| Warning-file redirection | formatted warnings append to the configured file | process-warnings.ts |
| `process.loadEnvFile([p])` v20.12 + cli `--env-file`/`--env-file-if-exists` v20.6/v20.12 | shared dotenv parser over `syncMirror().readFileBytesSync`; cli needs argv/flag seam BEFORE loader.import (none today); `-if-exists` swallows ENOENT | node-entry.ts:60 |
| `process.getBuiltinModule(id)` v22.3 | wrapper over `loadBuiltin(id) ?? undefined` | builtins/index.ts:49 |
| `module.SourceMap` + `findSourceMap(p)` v13.7 | surface class (`.payload`/`.findEntry`/`.findOrigin`) over `SourceMapRegistry`; subset = inline + per-loader, null untracked | source-maps.ts:40 |
| `process.setSourceMapsEnabled`/`sourceMapsEnabled`/`getSourceMapsSupport()` v16.6/v23 | module bool wired into withStackRemapping | source-maps.ts |
| `module.stripTypeScriptTypes` v22.13 (L) | sync pure-JS eraser (existing strip is ASYNC WASI esbuild); throw on enum/namespace unless transform | — |
| `data:` URL ESM import v12.10 | parse mediatype, `;base64`→atob else %-decode+TextDecoder, route executeEsm; no network | resolver.ts:129 |

2026-10-20 — ADR-0541 adds ordinary `emitWarning`: string/Error overloads,
nextTick warning events and default stderr. Undici's lowercase `patch`
constructor warning requires it; live-Node browser cases cover it. No generic
dedupe: undici owns its once-only PATCH warning.

Remaining warning-file gap: `NODE_REDIRECT_WARNINGS` reaches
`NotImplementedError('process.emitWarning.redirect')` in the default sink.
Owner: runtime-js; trigger: a caller needs persisted warning diagnostics.
Outside the Node Fetch goal's accepted scenarios. Dedup: this existing surface
item owns warning delivery; no matching goal/trap/declined redirection item.
Node 24.16.0 probe: `node --redirect-warnings=/tmp/rifty-fetch-warning-redirect-proof.log -e "process.emitWarning('redirect-proof', {code:'FETCH-REDIRECT'})"`
exits 0; the file contains `[FETCH-REDIRECT] Warning: redirect-proof`.

REGRESSION TRAP — `getBuiltinModule`: `net/src/sqlite/engine.ts:48` + `engine-shimmed-process.test.ts` use its ABSENCE as the "not a real Node realm" signal; adding it breaks sqlite init. MUST refactor detection (e.g. `versions.rifty` marker) + update the pin FIRST, regression test first.

2026-10-25 — salvaged from PR #158 (`plain-esm-inline-source-map-fidelity`,
not kept as its own item): Node 24.16.0 applies inline maps only with
`--enable-source-maps`/`setSourceMapsEnabled(true)` — a generated `.mjs`/`.cjs`
frame becomes `(<dir>/orig/src.ts:10:5)`, `sourceRoot` honoured; flag off it
stays the generated file, as rifty does. So the residual is enabled mode, owned
here: when it lands, scan plain JS/CJS inline maps (today only
`transformSource` output, `loader.ts:452-455`), keep `sources`/`sourceRoot`
(dropped: `source-maps.ts:28-31`) and swap the frame id (kept:
`source-maps.ts:249`). Today `--enable-source-maps` throws
`NotImplementedError` (unknown-option path, `node-startup-options.ts:43-47`);
`process.setSourceMapsEnabled` is absent (`TypeError` on call).

EXCLUDE `import.meta.resolve` — owned by `runtime-js/import-meta-resolve-node-results` (Node's absent-file URL, non-`file:` parent errors) and ADR-0449 (parent argument). `file://` import is shipped and covered in `tests/conformance/modules/resolver.test.ts`.

## Options or Next

Per-feature promotable, parity-first. Warning-file output remains a draft;
other frontiers: getBuiltinModule (sqlite-detection refactor + pin update first),
loadEnvFile/--env-file, SourceMap controls, data imports, stripTypeScriptTypes.

## Reversibility

REVERSIBLE — recorded here. getBuiltinModule's detection refactor touches a pinned cross-package contract; the marker choice (e.g. `versions.rifty`) is REVERSIBLE behavior-preserving but re-pin the test in the same change.
