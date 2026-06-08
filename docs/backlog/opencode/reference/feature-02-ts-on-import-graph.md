# Feature 02-ts-on-import-graph — TS-on-import across a package graph
> Part of the opencode-in-rifty facade effort. Feasibility phase P0. Staged doc — NOT a ratified ADR.

## Summary

Wire the existing single-file esbuild.wasm transform (`tools/shadow-registry` `transformWithEsbuild`) into the core module loader so every `.ts`/`.tsx`/JSX module across the opencode package graph gets types stripped / JSX lowered ON IMPORT, before the AST ESM rewriter (`esm.ts:39` `transformEsm`) parses it.

Three gaps to close:

1. **Resolver doesn't know `.ts`/`.tsx` are resolvable or ESM.** `DEFAULT_EXTENSIONS`/`INDEX_FILES` (`resolver.ts:25-26`) and `detectKind` (`resolver.ts:437-448`) handle only `.js`/`.mjs`/`.cjs`/`.json`; a bare `import { Session } from "@/session/session"` landing on `session.ts` won't resolve, and unknown extensions fall through to `'cjs'`.
2. **`executeEsm` feeds `resolved.source` straight to acorn** (`esm.ts:39`) → TS syntax throws `SYNTAX_ERROR`; a strip step must run first.
3. **Loader can't reach the WASI esbuild binary.** `createModuleLoader` (`loader.ts:50`) takes only `{ cwd }`; no `runWasi`/wasm/transform injection point.

The transform building block exists and is per-file stable with real cwd/preopens (`esbuild-binding.ts:115`, ADR-0047/0049). This feature makes it loader-wide via a per-file source-transform hook keyed on extension, threading a workspace/cwd context (the esbuild preopen) through.

This is the P0 gate (module-graph load): without it the opencode `.ts` graph never parses. It does NOT touch sqlite/`#db` (feature 03/04), the HTTP bridge (05), or boot (06) — purely "make `.ts`/`.tsx` parse like Node-with-a-stripper would".

## Decisions (classified)

### Decision 1 — How does the WASI esbuild transform reach the core module loader?

- **Classification:** IRREVERSIBLE
- **⚠️ IRREVERSIBLE — RECOMMENDED, awaiting human ratification. Do not start T2 until the ADR is ratified.**
- **Chosen (RECOMMENDED, not final):** Add an OPTIONAL injected transform hook to `ModuleLoaderOptions` — `transformSource?: (req: { source: string; id: string; loader: 'ts'|'tsx'|'jsx'; workspace: string }) => Promise<string>` — plus a `workspace?: string` field. `createModuleLoader` stays dependency-free; the caller (headless opencode harness, forked from `real-vite-smoke.ts`) injects a closure calling `transformWithEsbuild(runWasi, wasm, …)` from `tools/shadow-registry`. Mirrors the existing DI pattern where the esbuild binding takes an injected `runWasi` so the tool package carries no kernel/vfs/runtime-wasi edge (`esbuild-binding.ts:20-27,39-50`). Loader gains zero new package import edges; its public option type grows by two optional fields.
- **Alternatives:**
  - (A) Inline `import { transformWithEsbuild } from '@riftydev/...shadow-registry'` in `esm.ts`. REJECTED on layering: shadow-registry is a `tools/` data-table package; pulling it into runtime-js inverts vfs→kernel→runtime layering and forces a runtime-wasi edge into runtime-js.
  - (B) Global singleton transform registry (`publishRuntimeGlobal`, like `esmStash` at `esm.ts:43-45`) set once at startup — REVERSIBLE, no option change, but hides a hard data dependency in a global, is order-fragile and hard to test; weaker than explicit DI.
  - (C) Synchronous `transformSource` so the CJS path could use it — impossible: esbuild via `runWasi` is async; the ESM path (`executeEsm`) is already async so the async hook fits. opencode is `type:module` so `.ts`→ESM and the CJS `.ts` case doesn't arise on the facade path (`.ts` via CJS `require()` throws a directed `NotImplementedError`, never silently passes TS to `new Function`).
- **Trade-offs:** Two optional fields on `ModuleLoaderOptions` is a cross-package public-API change (rule 1 → IRREVERSIBLE) though additive. Pro: explicit, testable, no layering violation, no new dep, reused by future HMR/per-file invalidation. Con: every loader caller sees a TS-flavoured option; making the transform mandatory for arbitrary npm packages later would be a breaking follow-up. The hook request-object shape is the load-bearing contract and must be ratified, not invented.
- **Reversibility:** Touches public option type of `@riftydev/runtime-js` consumed cross-package (`loader.ts:11` `ModuleLoaderOptions`, re-exported via `src/index.ts`) — rule 1. Reverting after callers adopt `transformSource`/`workspace` ripples across the harness and other loader callers.
- **Proposed ADR:** ADR-00NN: TS-on-import transform hook on `ModuleLoaderOptions` (injected esbuild, async, extension-keyed)

### Decision 2 — Treat `.ts`/`.tsx` as resolvable, importable, and classify as ESM?

- **Classification:** IRREVERSIBLE
- **⚠️ IRREVERSIBLE — RECOMMENDED, awaiting human ratification. Deviates from Node resolution (Node doesn't resolve bare `.ts`); needs sign-off before T1.**
- **Chosen (RECOMMENDED, not final):** Extend `DEFAULT_EXTENSIONS` (`resolver.ts:25`) and `INDEX_FILES` (`resolver.ts:26`) with `'.ts'`,`'.tsx'` (after the `.js` family, before `.json`, so extensionless `./foo` prefers `foo.js` then `foo.ts`, matching a TS-aware Node loader). Extend `detectKind` (`resolver.ts:437-448`) so `.ts`/`.tsx` classify ESM when the nearest package scope is `type:module` (reusing the `.js` branch at `resolver.ts:441-444`) else CJS. opencode is `type:module` so its `.ts` → ESM uniformly. UNCONDITIONAL (always resolve `.ts`): resolution and transform are separable; a `.ts` resolving with no transform hook throws a directed `'TS transform not configured for <id>'` (no silent stub), more honest than pretending `.ts` doesn't exist.
- **Alternatives:**
  - (A) Leave resolver untouched, special-case opencode in a shim overlay (rewrite `.ts`→`.js` at install) — REJECTED: opencode ships ~hundreds of `.ts` files with `"exports": { "./*": "./src/*.ts" }` and internal extensionless/`.ts` imports; a per-file overlay doesn't scale and the resolver already does Node resolution.
  - (B) Resolve `.ts` but classify CJS (current unknown-extension default) — REJECTED: opencode is `type:module` with top-level import/export; CJS via `new Function` (`cjs.ts:65`) mis-handles ESM and TS.
  - (C) Add `.ts` only behind a feature flag — extra surface for little gain; the directed-throw-when-no-transform already prevents misuse.
- **Trade-offs:** Changing `DEFAULT_EXTENSIONS`/`INDEX_FILES`/`detectKind` alters resolver behaviour for ALL `@riftydev/runtime-js` consumers including the vite path and conformance suite (rule 1 public behaviour + rule 4 >2 files: `resolver.ts`+`esm.ts`+`loader.ts`). Pro: matches TS-on-import expectation, needed for the whole opencode tree. Con/risk: a package shipping BOTH `foo.js` and `foo.ts` could resolve differently than Node (which never resolves `.ts`) — verify `.js`/`.mjs`/`.cjs` order first so plain-Node packages are unaffected; add a parity case asserting a `.js`-bearing package still resolves the `.js`. This ordering-vs-Node deviation most needs sign-off.
- **Reversibility:** Resolver extension list + kind detection is observable cross-package public behaviour; edit spans `resolver.ts`+`esm.ts`+`loader.ts` (>2 files, rule 4). Deviates from Node (no bare `.ts`) → semantic contract change, not an internal helper.
- **Proposed ADR:** ADR-00NN: `.ts`/`.tsx` as first-class resolvable+ESM module extensions in the rifty resolver (ordering relative to `.js`, `type:module` classification)

### Decision 3 — Which esbuild loader per file, and how is JSX handled?

- **Classification:** REVERSIBLE
- **Chosen:** Pick loader by extension at the hook call site: `.ts`→`'ts'`, `.tsx`→`'tsx'`, `.jsx`→`'jsx'`, else no transform (pass through to `transformEsm` unchanged). For `.tsx`/`.jsx` pass `jsx:'automatic'` (modern default opencode/Effect expects) via `EsbuildTransformOptions.jsx` (`esbuild-binding.ts:67`). Do NOT read `tsconfig.json` jsx settings in P0.
- **Alternatives:** Read each package's `tsconfig.json` `jsxImportSource`/jsx mode (more faithful, but opencode's facade serve path has no `.tsx` per the pruned dep list — TUI/@opentui pruned — so JSX is dead weight in P0); or default `jsx:'transform'` (classic) — wrong for automatic-runtime code.
- **Trade-offs:** Extension-only selection is simple and covers the entire (JSX-free) facade path. Risk: a kept dep shipping `.tsx` expecting a specific `jsxImportSource` would get the wrong runtime — acceptable for P0; revisit if a kept package brings JSX.
- **Reversibility:** Pure call-site logic (extension→loader map, one jsx default), no public API, no dep, <20 lines, one file. Rule 5.

### Decision 4 — Cache transformed-source results, keyed how?

- **Classification:** REVERSIBLE
- **Chosen:** Cache stripped output per resolved file id inside the loader (`Map<id,string>`), populated lazily on first transform, dropped by the existing `invalidate(id)` path (`loader.ts:144`, `ModuleRegistry.invalidate`). Key by absolute id only (content immutable for a given installed package version in the VFS overlay). Avoids re-running the WASI binary for the same module across the graph and across repeated harness runs in one loader instance.
- **Alternatives:** No cache (re-transform every `executeEsm`) — simpler but the opencode graph is large and each transform is a full WASI process spawn; measurable. Content-hash key — more correct under live edits, unnecessary in P0 where installed sources don't mutate; id-keyed cache already invalidates via the registry hook.
- **Trade-offs:** Id-keyed cache is fast and integrates with existing invalidate semantics. Risk under future HMR/editor edits: an in-place edit needs explicit `invalidate(id)` to drop the stale strip — acceptable, invalidate exists for that hot path (`loader.ts:24-31` docstring).
- **Reversibility:** Internal `Map` inside `createModuleLoader`, no public API, no dep, <30 lines, single file. Rule 5.

### Decision 5 — What is the esbuild 'workspace' (cwd preopen) for graph-wide transforms?

- **Classification:** REVERSIBLE
- **Chosen:** Single workspace root = loader cwd (`loader.ts:53`), threaded into the hook as `workspace`. esbuild's stdin transform only needs a cwd preopen that EXISTS in the sync VFS mirror (`esbuild-binding.ts:60-66`, ADR-0049); a single-file type-strip doesn't resolve relative imports through esbuild (rifty's resolver does), so per-package cwd is unnecessary. Pass `workspace = opts.workspace ?? opts.cwd ?? '/workspace'`.
- **Alternatives:** Per-file package root (`resolved.packageRoot`, `resolver.ts:15/433`) — more 'correct' but pointless for typestrip-only and multiplies preopen churn; esbuild does no module resolution here. Fixed `'/workspace'` literal — fine for the harness but couples the loader to a magic path; `opts.cwd` is more honest.
- **Trade-offs:** Single root is simplest and matches the vite precedent (`real-vite-smoke` uses `ROOT='/workspace'` as cwd and esbuild workspace, `real-vite-smoke.ts:42,120`). Risk: file-relative resolution (e.g. esbuild bundling) would need the right root — out of scope for type-strip.
- **Reversibility:** Internal wiring of an existing optional field into an existing call; no new public API beyond the hook above; <15 lines. Rule 5.

## Interface contract

```ts
// @riftydev/runtime-js — module-loader/loader.ts (PUBLIC, re-exported via src/index.ts)
export interface ModuleLoaderOptions {
  readonly cwd?: string;                       // existing
  /** esbuild guest cwd/preopen for TS-strip; defaults to cwd ?? '/workspace'. */
  readonly workspace?: string;                 // NEW (optional)
  /** Injected per-file source transform. Called for .ts/.tsx/.jsx BEFORE the
   *  AST ESM rewrite. Absent => .ts/.tsx resolve but throw a directed
   *  'TS transform not configured' error on execute (no silent stub). */
  readonly transformSource?: TransformSourceHook;   // NEW (optional)
}
export type TransformSourceHook = (req: {
  readonly source: string;
  readonly id: string;                         // absolute resolved file path
  readonly loader: 'ts' | 'tsx' | 'jsx';
  readonly workspace: string;
}) => Promise<string>;                          // returns stripped/lowered JS

// module-loader/resolver.ts (behaviour change, no signature change)
//   DEFAULT_EXTENSIONS += '.ts','.tsx'  (after .js family)
//   INDEX_FILES        += 'index.ts','index.tsx'
//   detectKind(): '.ts'/'.tsx' -> ESM iff nearest pkg type==='module' else CJS

// module-loader/esm.ts — executeEsm gains a pre-transformEsm strip step:
//   if id endsWith .ts/.tsx/.jsx: source = await deps.transformSource(...)
//   then transformEsm(source, id) as today (esm.ts:39).
// EsmLoaderDeps gains: transformSource?: TransformSourceHook; workspace: string.

// Caller (headless opencode harness, forked from tests/integration/fixtures/real-vite-smoke.ts):
//   const { transformWithEsbuild, loadVendoredEsbuildWasm } from '@riftydev tools/shadow-registry'
//   const wasm = loadVendoredEsbuildWasm();
//   createModuleLoader(fsSync, { cwd: ROOT, workspace: ROOT,
//     transformSource: ({source,loader,workspace}) =>
//       transformWithEsbuild(runWasi, wasm, { source, loader, workspace, format:'esm', jsx: loader!=='ts'?'automatic':undefined })
//         .then(r => r.code) });
```

## Affected packages & seams

**Packages:** `packages/runtime-js`, `tools/shadow-registry`, `tests/integration`

**Seam anchors:**

- `packages/runtime-js/src/module-loader/loader.ts:11`, `:50`, `:82`
- `packages/runtime-js/src/module-loader/esm.ts:39`, `:22`
- `packages/runtime-js/src/module-loader/resolver.ts:25`, `:231`, `:437`
- `tools/shadow-registry/src/esbuild-binding.ts:115`, `:55`
- `tests/integration/fixtures/real-vite-smoke.ts:107`
- `packages/runtime-js/src/index.ts:4`

## Dependencies

**Depends on:** `01-load-opencode-into-vfs`

**Blocker proximity:** FAR from the hard blockers, squarely feasible. Strips types and lowers JSX at import time via the proven WASI esbuild binary (ADR-0047/0049) — no process spawn, PTY, native SQLite, or file watching. It deliberately avoids the three import-time fatals owned by sibling features: does not register/shim `node:sqlite`/`bun:sqlite`/`#db` (03/04), does not add a `'bun'` resolver condition (`resolver.ts:231` stays `[node,default,import,require]` — feature 03's call), does not stub `#pty` (04). Purely syntactic/transformational. The nearest blocker-adjacency: loading the WHOLE graph hits the `node:sqlite`/`#db` wall the moment `session.ts` is reached — but that wall is out of scope (dependsOn 01 for VFS contents; 03/04 before the full tree loads). P0 acceptance validates on a curated safe subset that imports no sqlite/pty.

## Test strategy

1. **PARITY (gold standard)** — parity-runner case: a tiny multi-file `.ts` graph (`a.ts` imports type+value from `b.ts`; `b.ts` re-exports an enum/interface and a const) loaded through `createModuleLoader` with the real esbuild hook, diff runtime stdout vs Node-run equivalent `.ts` (Node via `tsx`/`--experimental-strip-types`) — proves type-stripping + cross-file import order match Node. Runs sandbox-disabled per convention.
2. **UNIT (runtime-js resolver)** — `foo.ts` resolves when `foo.js` absent; `foo.js` still wins when BOTH exist (decision 2 Node-deviation guard); `index.ts` resolves as directory index; `.ts` classifies ESM in `type:module` scope, CJS otherwise. `detectKind` unit cases.
3. **UNIT (`esm.ts`)** — a `.ts` module with no `transformSource` throws the directed `'TS transform not configured'` (no silent stub); with a stub `transformSource` stripping a marker, the stripped output reaches `transformEsm`.
4. **CONFORMANCE** — re-run module-loader conformance to prove `.js`/`.mjs`/`.cjs`/`.json` and the vite path are byte-unchanged (regression guard for the extension-list edit).
5. **INTEGRATION (smallest opencode slice)** — fork `real-vite-smoke.ts` into an opencode-ts-graph smoke installing a SMALL real TS subgraph (or vendoring 3-4 opencode `.ts` files with only safe imports — no `#db`/`#pty`), assert `loader.import` resolves+executes them. P0 acceptance signal; gated by 01 and 03/04 for the full tree, so this uses a curated safe subset.

Each test maps to a failure mode: `SYNTAX_ERROR` on TS (no strip), `MODULE_NOT_FOUND` on `.ts` (no extension), wrong kind (CJS-on-ESM), silent pass-through (no-hook stub), Node-ordering deviation (`.js` vs `.ts`).

## Implementation plan (test-first)

1. **T1 — Resolver: `.ts`/`.tsx` first-class resolvable extensions + index files, classified by package scope.** (conformance)
   `DEFAULT_EXTENSIONS` (`resolver.ts:25`) → `['.js','.mjs','.cjs','.ts','.tsx','.json']` (`.js` family FIRST so plain-Node packages are byte-unchanged, `.ts`/`.tsx` before `.json`). `INDEX_FILES` (`resolver.ts:26`) += `'index.ts'`,`'index.tsx'` same order. `detectKind` (`resolver.ts:437`): `.ts`/`.tsx` → `'esm'` when nearest scope is `type:module` (reusing `findPackageScope` at `resolver.ts:441-444`), else `'cjs'`. Resolve-side half; transform-side (T2/T3) is separate so a `.ts` resolves even with no transform (then throws a directed error at execute, never a silent stub).
   - **FAILING test first:** `tests/conformance/modules/resolver.test.ts` `describe('TS extension resolution')`: (a) `resolves foo.ts when foo.js is absent` → `'./foo'` lands on `/app/foo.ts`; (b) NODE-DEVIATION GUARD `prefers foo.js over foo.ts when both exist` → both `/app/foo.js` and `/app/foo.ts`, `.id` MUST end `.js`; (c) `resolves a directory via index.ts` → `'./dir'` with only `/app/dir/index.ts`; (d) `detectKind`: `/p/a.ts` under `{"type":"module"}` → `'esm'`, `/q/b.ts` without type:module → `'cjs'`. All FAIL first (today `.ts` absent from `DEFAULT_EXTENSIONS` → (a)(c) `MODULE_NOT_FOUND`; `detectKind` returns `'cjs'` for any `.ts` → (d)-esm fails).
   - **Files:** `packages/runtime-js/src/module-loader/resolver.ts`, `tests/conformance/modules/resolver.test.ts`

2. **T2 — Public option surface: two optional fields on `ModuleLoaderOptions`.** (unit)
   Add `readonly workspace?: string` and `readonly transformSource?: TransformSourceHook` (`loader.ts:11`), export `TransformSourceHook`. Thread `workspace = opts.workspace ?? opts.cwd ?? STUB_FROM_FILE_DEFAULT` and `transformSource` into the `deps` object in `createModuleLoader` (`loader.ts:55-103`) for the esm path (T3). Re-export `TransformSourceHook` from `module-loader/index.ts`. NO behaviour change yet; loader gains no new package import edge (hook injected by caller). This is the IRREVERSIBLE public-API decision (decision 1) and the ratification gate.
   - **FAILING test first:** `packages/runtime-js/src/module-loader/loader-transform.test.ts` :: `passes workspace and transformSource through to the esm execute path` — `createModuleLoader(vfs, { cwd:'/work', workspace:'/work', transformSource: spy })`, fixture `/work/main.ts` imports `/work/dep.ts`; spy records `{id,loader,workspace}` and returns source with sentinel `'/*X*/'` stripped. Assert spy invoked for BOTH `main.ts` and `dep.ts` with `loader:'ts'`, `workspace:'/work'`. Fails first: no `transformSource`/`workspace` field (TS compile error IS the red state).
   - **Files:** `packages/runtime-js/src/module-loader/loader.ts`, `.../module-loader/index.ts`, `.../module-loader/loader-transform.test.ts`

3. **T3 — `esm.ts` strip step.** (unit)
   Add `transformSource?: TransformSourceHook` and `workspace: string` to `EsmLoaderDeps` (`esm.ts:8-13`). In `executeEsm` (`esm.ts:39`), BEFORE `transformEsm`: if `resolved.id` ends `.ts`/`.tsx`/`.jsx`, derive loader from extension (`.ts`→`'ts'`, `.tsx`→`'tsx'`, `.jsx`→`'jsx'`; decision 3 — extension-only, `jsx:'automatic'` chosen at the CALLER); if `deps.transformSource` present set `source = await deps.transformSource({...})`; if ABSENT, throw a directed `ModuleLoadError`/`NotImplementedError` `TS transform not configured for <id>` (NO silent stub). Then `transformEsm(source, resolved.id)` as today. Wire `deps.workspace`/`transformSource` from `loader.ts` (T2).
   - **FAILING test first:** `packages/runtime-js/src/module-loader/esm.test.ts` (new) :: (a) `throws a directed error when a .ts module is executed with no transformSource` — loader with NO hook, fixture `/work/main.ts` = `export const x: number = 1`, `loader.import('./main.ts',...)` rejects matching `/TS transform not configured/` (NOT acorn `SYNTAX_ERROR`, NOT silent); (b) `feeds stripped source to transformEsm` — stub `transformSource` removes `: number`; assert `loader.import` resolves and exported `x === 1`. Both fail first (a→acorn `SYNTAX_ERROR` wrong message; b→hook missing).
   - **Files:** `packages/runtime-js/src/module-loader/esm.ts`, `.../module-loader/esm.test.ts`

4. **T4 — CJS `.ts` honesty: loud directed throw.** (unit)
   In `loader.ts` `require()` and `deps.loadSync`, when a resolved module is `kind:'cjs'` but id ends `.ts`/`.tsx`, throw `NotImplementedError('module-loader.ts-via-require')` explaining the esbuild hook is async-only and `require()` of `.ts` is unsupported on the facade path (decision 1 alt C — opencode is `type:module` so this never arises happy-path, but must be loud). Register in compat-matrix as not-supported. The `.ts`→esm happy path is unaffected.
   - **FAILING test first:** `loader-transform.test.ts` :: `require() of a .ts module throws a directed NotImplementedError, never silently new-Functions TS` — fixture `/work/legacy.ts` under NON-module package.json (`detectKind`→cjs), `loader.require('./legacy.ts','/work/e.js')` throws `NotImplementedError` matching `/require\(\) of .*\.ts/`. Fails first: today the unknown-extension cjs path feeds TS to `executeCjs`/`new Function`.
   - **Files:** `packages/runtime-js/src/module-loader/loader.ts`, `.../cjs.ts`, `docs/compat/`, `.../loader-transform.test.ts`

5. **T5 — Loader-internal transform cache (decision 4, REVERSIBLE).** (unit)
   In `createModuleLoader` add a `Map<string,string>` keyed by absolute resolved id, populated lazily on first `transformSource`, read before re-invoking the hook, cleared by the existing `invalidate(id)` path (`loader.ts:144` → `registry.invalidate`). Wrap `deps.transformSource` so `esm.ts` is unaware of caching. Mark `TODO(ADR)`. Avoids re-spawning the WASI esbuild process per module across the large graph and across repeated harness runs in one loader instance.
   - **FAILING test first:** `loader-transform.test.ts` :: `transforms each .ts id at most once across repeated imports, and drops the cache on invalidate` — `transformSource` counting spy; import same `/work/main.ts` twice, assert count `=== 1`; then `invalidate('/work/main.ts')`, import again, assert `=== 2`. Fails first: no cache → count 2 after first repeat (or, if registry memoises the executed module, the invalidate-then-reimport leg expecting a 2nd transform is the part that fails first).
   - **Files:** `packages/runtime-js/src/module-loader/loader.ts`, `.../loader-transform.test.ts`, `OPEN_QUESTIONS.md`

6. **T6 — Parity-runner harness extension (prereq for gold case T7).** (harness)
   Add a TS kind: `types.ts` `ParityCase.kind` += `'ts-esm'`. `run-in-node.ts` (`run-in-node.ts:36`) writes the entry as `main.ts` (setup `.ts` keep names) and spawns `process.execPath` — Node v24 strips types by default (verified: only `--no-experimental-strip-types` exists), no flag needed; on non-v24 Node fall back to vendored `tsx` (`node_modules/.bin/tsx`). `run-in-rifty.ts` (`run-in-rifty.ts:28,52`) writes `main.ts` for `'ts-esm'` and builds `createModuleLoader(vfs, { cwd:'/work', workspace:'/work', transformSource })` where `transformSource` calls `transformWithEsbuild(runWasi, loadVendoredEsbuildWasm(), { source, loader, workspace, format:'esm', jsx: loader!=='ts'?'automatic':undefined }).then(r=>r.code)` — injecting `runWasi` from `@riftydev/runtime-wasi` (allowed: the parity runner is a `tools/` harness, may depend on runtime-wasi + shadow-registry without violating layer rules). HARNESS task: its 'test' is that the existing parity suite still passes AND a trivial new `ts-esm` smoke runs green both sides.
   - **FAILING test first:** `tools/node-parity-runner/cases/modules/ts-strip-smoke.case.ts` (kind `'ts-esm'`) single-file `const x: number = 41; console.log(x + 1)`, expected `'42'`. `pnpm test:parity` (sandbox-disabled) FAILS first because (a) `types.ts` rejects `'ts-esm'`, (b) `run-in-rifty` writes `main.js` → acorn `SYNTAX_ERROR`, (c) `run-in-node` writes `main.js` (wrong ext, no strip). Going green proves the runner threads the real esbuild hook end-to-end.
   - **Files:** `tools/node-parity-runner/src/types.ts`, `.../src/run-in-node.ts`, `.../src/run-in-rifty.ts`, `.../cases/modules/ts-strip-smoke.case.ts`

7. **T7 — GOLD-STANDARD parity case (test strategy level 1).** (parity)
   A multi-file `.ts` graph proving type-stripping + cross-file ESM import order match Node-with-a-stripper. `b.ts` exports an interface (type-only, must vanish), an enum, and a const; `a.ts` imports the type (erased) and the value from `b.ts` and prints a result depending on cross-file load order. Same source runs in Node v24 (strip-types) and rifty (esbuild hook via T6); stdouts diffed. P0 acceptance signal at the language level, independent of opencode VFS contents.
   - **FAILING test first:** `tools/node-parity-runner/cases/modules/ts-graph-cross-file.case.ts` (kind `'ts-esm'`, `setup.files: { 'b.ts': '<enum Color { R, G } export interface Box{n:number} export const base: number = 40; export { Color }>', 'a.ts': '<import { base, Color, type Box } from "./b.ts"; const box: Box = { n: 2 }; console.log(base + box.n + Color.G)>' }`, code imports `'./a.ts'`). Expected stdout `'43'`. FAILS first until T1+T2+T3+T6: rifty `MODULE_NOT_FOUND` (no ext) or `SYNTAX_ERROR` (no strip); Node prints 43 → parity fail.
   - **Files:** `tools/node-parity-runner/cases/modules/ts-graph-cross-file.case.ts`

8. **T8 — Regression guard for the resolver extension-list edit.** (conformance)
   Re-run module-loader conformance + the real-vite path to prove `.js`/`.mjs`/`.cjs`/`.json` and the vite `transformRequest` path are byte-unchanged after `.ts`/`.tsx` entered `DEFAULT_EXTENSIONS`/`INDEX_FILES`. Asserts only 'plain-JS packages resolve identically'; new `.ts` behaviour is T1. Catches the decision-2 risk: a package shipping both `source.ts` and `build.js` must still pick `.js`.
   - **FAILING test first:** `tests/conformance/modules/resolver.test.ts` :: `a package that ships both index.ts and index.js still resolves index.js (Node parity)` — `node_modules/lib` with BOTH `index.ts` and `index.js`, NO exports field, `require('lib')` returns the `.js` export. Then full `pnpm test:conformance` + existing `tests/integration` vite live run (sandbox-disabled) as the gate. The sub-test fails first if `.ts` were ordered before `.js` in `INDEX_FILES`; the suite run guards kind/ordering drift.
   - **Files:** `tests/conformance/modules/resolver.test.ts`

9. **T9 — Curated opencode `.ts` subgraph integration smoke (test strategy level 5 — P0 acceptance for THIS feature, safe subset).** (integration)
   Fork `tests/integration/fixtures/real-vite-smoke.ts` into `opencode-ts-graph-smoke.ts` mounting 3-4 hand-vendored opencode-style `.ts` files (`type:module` package.json, internal relative + `#`-condition imports resolving to `.ts`, e.g. `#tool/x`→`./src/x.ts`), NO `#db`/`#pty`/`bun:sqlite` (features 03/04). Loader with the esbuild `transformSource` hook (same wiring as T6/`real-vite-smoke`). Assert `loader.import` resolves and EXECUTES the entry, printing `RIFTY_TS_GRAPH_OK`. Runs under `tsx` in a separate process (replaces `globalThis.process`), driven by an opt-in `.test.ts` that spawns it (mirroring `vite-live-run.opt-in.test.ts`). A full real-opencode-from-VFS run depends on feature 01; this curated subset stays inside the ceiling without blocking on 01/03/04.
   - **FAILING test first:** `tests/integration/opencode-ts-graph.opt-in.test.ts` spawns the fixture under `tsx`, asserts the child prints `'RIFTY_TS_GRAPH_OK'` and exits 0. Fails first: fixture doesn't exist; before T1-T3 the `.ts` files `MODULE_NOT_FOUND` (no ext) / `SYNTAX_ERROR` (no strip). Each failure mode (resolve, strip, `#`-condition-to-`.ts`) maps to a concrete assertion in the child log.
   - **Files:** `tests/integration/fixtures/opencode-ts-graph-smoke.ts`, `tests/integration/opencode-ts-graph.opt-in.test.ts`

### Scaffolding sketch

```ts
// ── packages/runtime-js/src/module-loader/resolver.ts (T1: behaviour change, no signature change)
const DEFAULT_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.json'] as const; // .js family FIRST, .ts/.tsx before .json
const INDEX_FILES = ['index.js','index.mjs','index.cjs','index.ts','index.tsx','index.json'] as const;
function detectKind(vfs: FsSync, filePath: string): ModuleKind {
  if (filePath.endsWith('.json')) return 'json';
  if (filePath.endsWith('.mjs')) return 'esm';
  if (filePath.endsWith('.cjs')) return 'cjs';
  if (filePath.endsWith('.js') || filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
    const scope = findPackageScope(vfs, filePath);
    return scope && scope.pkg.type === 'module' ? 'esm' : 'cjs';
  }
  return 'cjs';
}

// ── packages/runtime-js/src/module-loader/loader.ts (T2/T5: PUBLIC option surface — IRREVERSIBLE, re-exported via module-loader/index.ts and the @riftydev/runtime-js/loader subpath)
export type TransformSourceHook = (req: {
  readonly source: string;
  readonly id: string;            // absolute resolved file path
  readonly loader: 'ts' | 'tsx' | 'jsx';
  readonly workspace: string;
}) => Promise<string>;             // returns stripped/lowered JS
export interface ModuleLoaderOptions {
  readonly cwd?: string;                     // existing
  readonly workspace?: string;               // NEW optional — esbuild guest cwd/preopen; defaults cwd ?? '/__entry__'
  readonly transformSource?: TransformSourceHook; // NEW optional — absent => .ts execute throws directed error
}
// inside createModuleLoader:
//   const workspace = opts.workspace ?? opts.cwd ?? STUB_FROM_FILE_DEFAULT;
//   const transformCache = new Map<string,string>();              // T5, TODO(ADR)
//   const cachedTransform: TransformSourceHook | undefined = opts.transformSource && (async (req) => {
//     const hit = transformCache.get(req.id); if (hit !== undefined) return hit;
//     const out = await opts.transformSource!(req); transformCache.set(req.id, out); return out; });
//   deps = { ...existing, workspace, transformSource: cachedTransform };
//   invalidate(id) also: id ? transformCache.delete(id) : transformCache.clear();
// require()/loadSync: if (resolved.kind === 'cjs' && /\.tsx?$/.test(resolved.id)) throw new NotImplementedError('module-loader.ts-via-require', `require() of ${resolved.id} (TS) is not supported: the esbuild strip is async; opencode is type:module so .ts loads via import().`);

// ── packages/runtime-js/src/module-loader/esm.ts (T3)
export interface EsmLoaderDeps {
  /* existing */ readonly registry: ModuleRegistry; readonly resolver: Resolver;
  loadAsync(id: string): Promise<Record<string, unknown>>;
  resolve(specifier: string, fromFile: string, esm: boolean): ResolvedModule;
  readonly workspace: string;                       // NEW
  readonly transformSource?: TransformSourceHook;   // NEW
}
// executeEsm, just before line 39 `const transformed = transformEsm(resolved.source, resolved.id)`:
const TS_LOADER: Record<string, 'ts'|'tsx'|'jsx'> = { '.ts':'ts', '.tsx':'tsx', '.jsx':'jsx' };
let src = resolved.source;
const m = /(\.tsx?|\.jsx)$/.exec(resolved.id);
if (m) {
  if (!deps.transformSource) throw new ModuleLoadError('SYNTAX_ERROR', resolved.id, `TS transform not configured for ${resolved.id} (no transformSource hook on the loader).`, resolved.id);
  src = await deps.transformSource({ source: resolved.source, id: resolved.id, loader: TS_LOADER[m[0]], workspace: deps.workspace });
}
const transformed = transformEsm(src, resolved.id);

// ── tools/node-parity-runner/src/run-in-rifty.ts (T6: harness wires the REAL esbuild hook; tools/ may import runtime-wasi + shadow-registry)
import { runWasi } from '@riftydev/runtime-wasi';
import { transformWithEsbuild, loadVendoredEsbuildWasm } from '../../shadow-registry/src/index.ts';
const wasm = loadVendoredEsbuildWasm();
const transformSource = (req: {source:string; loader:'ts'|'tsx'|'jsx'; workspace:string}) =>
  transformWithEsbuild(runWasi, wasm, { source: req.source, loader: req.loader, workspace: req.workspace, format: 'esm', jsx: req.loader !== 'ts' ? 'automatic' : undefined }).then(r => r.code);
// kind 'ts-esm': files[`/work/main.ts`] = code; createModuleLoader(vfs, { cwd:'/work', workspace:'/work', transformSource });
// await loader.import('./main.ts', '/work/__entry.ts');
```

### Risks

- **Node-resolution DEVIATION:** rifty now resolves bare `.ts` where Node (no stripper config) doesn't. T1's both-exist guard keeps `.js` winning, but a package shipping ONLY `.ts` (rare, some Bun-first packages) resolves+strips where Node `MODULE_NOT_FOUND`s — intentional for the facade, the decision-2 part needing sign-off; cannot be byte-identical to Node.
- **DECLARATION FILES (`*.d.ts`/`.d.cts`/`.d.mts`) excluded from candidate matching — CLOSED by F02-DTS-EXCLUDE.** T1 added `.ts`/`.tsx` with NO declaration-file exclusion, so a target shipping only `.d.ts` resolved it (relative `./foo.d`→`foo.d.ts` via `${base}.ts`; explicit `./foo.d.ts` via `st.isFile` early return; a package whose `exports`/`main` names a `.d.ts`) — strip-types then fed types-only source to acorn → `SYNTAX_ERROR`. Node's strip-types loaders skip `.d.ts`. The resolver now rejects any `*.d.ts`/`.d.cts`/`.d.mts` candidate at every file-acceptance point (resolves as absent → `MODULE_NOT_FOUND`), surgically (a runnable sibling `foo.js` still wins). Conformance: `tests/conformance/modules/resolver.test.ts` `describe('declaration-file exclusion')`. NOTE: ADR-0053 (ratified, immutable) doesn't yet record this exclusion in its Deviation section; amending the immutable ADR is out of scope — a future superseding ADR or amendment note should fold the `.d.ts`-exclusion into ADR-0053's contract.
- **T6 lets the `tools/` parity runner import `@riftydev/runtime-wasi` + shadow-registry.** Layer-legal for a harness, but the parity suite now spawns the WASI esbuild process per `ts-esm` case — slower; verify the T5 cache + a small case count keep `pnpm test:parity` within CI budget. If `esbuild.wasm` is unvendored, `loadVendoredEsbuildWasm()` throws and ALL `ts-esm` cases fail loudly (acceptable directed error; run `scripts/fetch-esbuild-wasi.mjs`).
- **`transformEsm` (esm-ast.ts) parses the POST-strip JS with acorn;** if esbuild emits syntax acorn can't parse (e.g. certain decorators/lowering), the `SYNTAX_ERROR` path fires with a confusing message. Mitigate: keep `format:'esm'` and assert in T3 that stripped output round-trips through `transformEsm`.
- **`jsx:'automatic'` hardcoded at the caller for `.tsx`/`.jsx` (decision 3).** Facade serve path is JSX-free → dead weight in P0; if a KEPT dep ships `.tsx` authored against classic runtime the automatic default lowers wrong — out of scope per the design, revisit if a kept package brings JSX.
- **T9 uses HAND-VENDORED opencode `.ts` files, not the real tree** (feature 01 owns VFS load; 03/04 own `#db`/`#pty`/`bun:sqlite`). Proves the language/graph mechanism only; MUST NOT import anything tripping the sqlite/pty wall, or it leaves scope and fails for an unrelated reason.
- **CJS `.ts` loud-throw (T4) assumes opencode `.ts` is always `type:module`.** A vendored fixture `.ts` under a non-module scope hits `NotImplementedError` instead of loading — correct, but a fixture footgun; T9 fixtures must carry `type:module` package.json.

### Estimate

3-4 evening-units: T1 resolver+conformance ~0.5; T2 option surface ~0.25 (blocked on ratification); T3 esm strip ~0.5; T4 cjs loud-throw + compat ~0.25; T5 cache ~0.25; T6 parity-runner harness (both sides + runWasi wiring) ~1.0 (heaviest, first real WASI integration); T7 gold parity ~0.25; T8 regression ~0.25; T9 curated opencode integration smoke ~0.75. Roughly half the effort is T6.

### Ratification gate

**⚠️ BLOCKED until TWO irreversible decisions are ratified (both needsHumanRatification).**

1. **ADR-00NN 'TS-on-import transform hook on `ModuleLoaderOptions` (injected esbuild, async, extension-keyed)'** — adds `workspace?` and `transformSource?: TransformSourceHook` to the PUBLIC `ModuleLoaderOptions` of `@riftydev/runtime-js` (rule 1: cross-package public API). Load-bearing contract is the `TransformSourceHook` request shape `{source,id,loader,workspace}`+`Promise<string>` return — must be ratified, not invented. Gates T2 (hence T3/T5/T6/T7/T9).
2. **ADR-00NN '.ts/.tsx as first-class resolvable+ESM module extensions (ordering relative to .js, type:module classification)'** — changes `DEFAULT_EXTENSIONS`/`INDEX_FILES` + `detectKind`, observable cross-package behaviour DEVIATING from Node; spans `resolver.ts`+`esm.ts`+`loader.ts` (rule 1 + rule 4). The deviation (`.ts` resolving where Node won't, `.js`-wins ordering) needs sign-off. Gates T1.

Next free ADR numbers: **0052/0053** (highest on disk is 0051).

REVERSIBLE sub-decisions (loader-selection jsx default, transform cache, single workspace root) need only `OPEN_QUESTIONS` entries + `TODO(ADR)` markers, no gate.

Until 0052/0053 are ratified this plan can't start coding T1/T2; the test files (T1/T3/T7) may be written first as the red state since they are tests, not the irreversible change.
