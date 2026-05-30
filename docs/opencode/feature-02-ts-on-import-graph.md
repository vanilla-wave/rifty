# Feature 02-ts-on-import-graph — TS-on-import across a package graph
> Part of the opencode-in-rifty facade effort. Feasibility phase P0. Staged doc — NOT a ratified ADR.

## Summary

Wire the existing single-file esbuild.wasm transform (`tools/shadow-registry` `transformWithEsbuild`) into the core module loader so every `.ts`/`.tsx` (and JSX) module across the opencode package graph gets its types stripped / JSX lowered ON IMPORT, before the AST ESM rewriter (`esm.ts:39` `transformEsm`) parses it.

Three concrete gaps must close:

1. **The resolver does not know `.ts`/`.tsx` are resolvable extensions or that they are ESM.** `DEFAULT_EXTENSIONS`/`INDEX_FILES` (`resolver.ts:25-26`) and `detectKind` (`resolver.ts:437-448`) handle only `.js`/`.mjs`/`.cjs`/`.json`, so a bare `import { Session } from "@/session/session"` that lands on `session.ts` will not even resolve a file, and an unknown extension currently falls through to `'cjs'`.
2. **`executeEsm` feeds `resolved.source` straight to acorn** (`esm.ts:39`), so TS syntax throws `SYNTAX_ERROR` — a strip step must run first.
3. **The loader has no way to reach the WASI esbuild binary.** `createModuleLoader` (`loader.ts:50`) takes only `{ cwd }` and there is no `runWasi`/wasm/transform injection point.

The transform building block already exists and is per-file stable with real cwd/preopens (`esbuild-binding.ts:115`, ADR-0047/0049); this feature makes it loader-wide via a per-file source-transform hook keyed on extension, threading a workspace/cwd context (the esbuild preopen) through.

This is the gate for P0 (module-graph load): without it the opencode `.ts` graph never parses. It does NOT touch sqlite/`#db` (feature 03/04), the HTTP bridge (05), or boot (06) — it is purely "make `.ts`/`.tsx` parse like Node-with-a-stripper would".

## Decisions (classified)

### Decision 1 — How does the WASI esbuild transform reach the core module loader?

- **Question:** Add a transform hook to `ModuleLoaderOptions` (cross-package public API) or inline an esbuild import inside runtime-js?
- **Classification:** IRREVERSIBLE
- **⚠️ WARNING: IRREVERSIBLE — RECOMMENDED, awaiting human ratification. Do not start coding T2 until the ADR is ratified.**
- **Chosen:** RECOMMENDED (not final): Add an OPTIONAL injected transform hook to `ModuleLoaderOptions` — `transformSource?: (req: { source: string; id: string; loader: 'ts'|'tsx'|'jsx'; workspace: string }) => Promise<string>` — and a `workspace?: string` field. `createModuleLoader` stays dependency-free; the caller (the headless opencode harness, forked from `real-vite-smoke.ts`) injects a closure that calls `transformWithEsbuild(runWasi, wasm, …)` from `tools/shadow-registry`. This mirrors the existing DI pattern where the esbuild binding takes an injected `runWasi` precisely so the tool package carries no kernel/vfs/runtime-wasi edge (`esbuild-binding.ts:20-27,39-50`). The loader gains zero new package import edges; only its public option type grows by two optional fields.
- **Alternatives:**
  - (A) Inline `import { transformWithEsbuild } from '@rifty/...shadow-registry'` directly in `esm.ts`. REJECTED on layering: shadow-registry is a `tools/` data-table package and pulling it into runtime-js would invert the vfs→kernel→runtime layering and force a runtime-wasi edge into runtime-js (the binding header explicitly avoids this).
  - (B) A global singleton transform registry (`publishRuntimeGlobal`, like `esmStash` at `esm.ts:43-45`) set once at startup — REVERSIBLE and needs no option change, but hides a hard data dependency in a global, is order-fragile, and is hard to test in isolation; weaker than explicit DI.
  - (C) Make `transformSource` synchronous so the CJS path can use it too — esbuild via `runWasi` is async, so a sync hook is impossible without blocking; the ESM path is async (`executeEsm`) so the async hook fits there; opencode is `type:module` so `.ts`→ESM and the CJS `.ts` case does not arise on the facade path (document that `.ts` required via CJS `require()` throws a directed `NotImplementedError` rather than silently passing TS to `new Function`).
- **Trade-offs:** Adding two optional fields to `ModuleLoaderOptions` is a public-API surface change between packages (reversibility rule 1 → IRREVERSIBLE) even though it is additive and optional. Pro: explicit, testable, no layering violation, no new dep, future HMR/per-file invalidation reuses it. Con: every loader caller now sees a TS-flavoured option; if later we want the transform to be mandatory for arbitrary npm packages it may need to become non-optional (a breaking follow-up). The shape of the hook (the request object fields) is the load-bearing contract and should be ratified, not invented.
- **Reversibility justification:** Touches the public option type of `@rifty/runtime-js` consumed across packages (`loader.ts:11` `ModuleLoaderOptions`, re-exported via `src/index.ts`) — rule 1 fires. Reverting after callers adopt `transformSource`/`workspace` would ripple across the harness and any other loader caller.
- **Proposed ADR:** ADR-00NN: TS-on-import transform hook on `ModuleLoaderOptions` (injected esbuild, async, extension-keyed)

### Decision 2 — Should the resolver treat `.ts`/`.tsx` as resolvable, importable extensions, and classify them as ESM?

- **Question:** Should the resolver treat `.ts`/`.tsx` as resolvable, importable extensions, and classify them as ESM?
- **Classification:** IRREVERSIBLE
- **⚠️ WARNING: IRREVERSIBLE — RECOMMENDED, awaiting human ratification. This deviates from Node resolution (Node does not resolve bare `.ts`); needs human sign-off before coding T1.**
- **Chosen:** RECOMMENDED (not final): Extend `DEFAULT_EXTENSIONS` (`resolver.ts:25`) and `INDEX_FILES` (`resolver.ts:26`) to include `'.ts'`,`'.tsx'` (after the `.js` family, before `.json` so extensionless `./foo` prefers `foo.js` then `foo.ts`, matching how a TS-aware Node loader orders), and extend `detectKind` (`resolver.ts:437-448`) so `.ts`/`.tsx` classify as ESM when the nearest package scope is `type:module` (matching the existing `.js` branch logic at `resolver.ts:441-444`) else CJS. opencode is `type:module` so its `.ts` → ESM uniformly. Gate the new extensions behind the presence of the transform hook OR make them unconditional — recommend UNCONDITIONAL (always resolve `.ts`), because resolution and transform are separable and a `.ts` that resolves but has no transform hook should throw a directed `'TS transform not configured for <id>'` error (no silent stub), which is more honest than pretending `.ts` does not exist.
- **Alternatives:**
  - (A) Leave resolver untouched and only special-case opencode paths in a shim overlay (rewrite `.ts`→`.js` at install time) — REJECTED: opencode ships ~hundreds of `.ts` source files with `"exports": { "./*": "./src/*.ts" }` and internal relative imports written without extensions or with `.ts`; a per-file overlay does not scale and the resolver already does Node resolution, so the gap belongs there.
  - (B) Resolve `.ts` but classify as CJS (current unknown-extension default) — REJECTED: opencode is `type:module` and uses top-level import/export; CJS execution via `new Function` (`cjs.ts:65`) would mis-handle ESM and TS both.
  - (C) Add `.ts` to extensions only when a feature flag is set — extra surface for little gain; the directed-throw-when-no-transform already prevents accidental misuse.
- **Trade-offs:** Changing `DEFAULT_EXTENSIONS`/`INDEX_FILES` and `detectKind` alters resolver behaviour for ALL consumers of `@rifty/runtime-js`, including the existing vite path and conformance suite — that is cross-cutting behaviour (rule 1 public-API/behaviour + rule 4 likely >2 files: `resolver.ts` + `esm.ts` + `loader.ts`). Pro: matches real-world TS-on-import expectation and is needed for the whole opencode tree. Con/risk: a real npm package that ships BOTH `foo.js` and `foo.ts` (e.g. source alongside build) could now resolve differently than Node (which never resolves `.ts`) — must verify ordering puts `.js`/`.mjs`/`.cjs` first so plain-Node packages are unaffected, and add a parity case asserting that a `.js`-bearing package still resolves the `.js`. This ordering-vs-Node deviation is the part most needing human sign-off.
- **Reversibility justification:** Resolver extension list + kind detection is observable public behaviour of the runtime consumed cross-package, and the edit spans `resolver.ts` + `esm.ts` + `loader.ts` (>2 files, rule 4). It can deviate from Node's resolution (Node does not resolve bare `.ts`) so it is a semantic contract change, not an internal helper.
- **Proposed ADR:** ADR-00NN: `.ts`/`.tsx` as first-class resolvable+ESM module extensions in the rifty resolver (ordering relative to `.js`, `type:module` classification)

### Decision 3 — Which esbuild loader is selected per file, and how is JSX handled?

- **Question:** Which esbuild loader is selected per file, and how is JSX handled?
- **Classification:** REVERSIBLE
- **Chosen:** Pick the loader purely by extension at the transform-hook call site: `.ts` → `'ts'`, `.tsx` → `'tsx'`, `.jsx` → `'jsx'`, everything else → no transform (pass through to `transformEsm` unchanged). For `.tsx`/`.jsx` pass `jsx:'automatic'` (the modern default opencode/Effect code expects) via the existing `EsbuildTransformOptions.jsx` field (`esbuild-binding.ts:67`). Do NOT attempt to read `tsconfig.json` jsx settings in P0.
- **Alternatives:** Read each package's `tsconfig.json` for `jsxImportSource`/jsx mode (more faithful, but opencode's facade serve path has no `.tsx` on it per the pruned dependency list — TUI/@opentui is pruned — so JSX is effectively dead weight for P0); or default `jsx:'transform'` (classic) — wrong for code authored against the automatic runtime.
- **Trade-offs:** Extension-only loader selection is simple and covers the entire facade path (which is `.ts`, no `.tsx`). Risk: if some kept dep ships `.tsx` expecting a specific `jsxImportSource`, the automatic default could pick the wrong runtime — acceptable for P0 since the serve path is JSX-free; revisit if a kept package brings JSX.
- **Reversibility justification:** Pure logic at the call site (extension→loader map, one jsx default), no public API change, no dep, reverts in <20 lines in one file. Rule 5.
- **Open question:** Q-2026-05-30-201

### Decision 4 — Should transformed-source results be cached, and keyed how?

- **Question:** Should transformed-source results be cached, and keyed how?
- **Classification:** REVERSIBLE
- **Chosen:** Cache the stripped output per resolved file id inside the loader (a `Map<id,string>`), populated lazily on first transform and dropped by the existing `invalidate(id)` path (`loader.ts:144`, `ModuleRegistry.invalidate`). Key by absolute id only (content is immutable for a given installed package version in the VFS overlay). This avoids re-running the WASI binary for the same module across the graph and across repeated harness runs within one loader instance.
- **Alternatives:** No cache (re-transform every `executeEsm`) — simpler but the opencode graph is large and each transform is a full WASI process spawn; measurable cost. Content-hash key — more correct under live edits but unnecessary in P0 where installed sources do not mutate; the id-keyed cache already invalidates via the registry hook.
- **Trade-offs:** Id-keyed cache is fast and integrates with existing invalidate semantics. Risk under HMR/editor edits (a future M-feature): a file edited in place would need explicit `invalidate(id)` to drop the stale strip — acceptable because invalidate already exists for exactly that hot path (`loader.ts:24-31` docstring).
- **Reversibility justification:** Internal `Map` inside `createModuleLoader`, no public API, no dep, <30 lines, single file. Rule 5.
- **Open question:** Q-2026-05-30-202

### Decision 5 — What is the esbuild 'workspace' (cwd preopen) for graph-wide transforms?

- **Question:** What is the esbuild 'workspace' (cwd preopen) for graph-wide transforms — one workspace root, or per-file package root?
- **Classification:** REVERSIBLE
- **Chosen:** Use a single workspace root = the loader's cwd (`loader.ts:53`), threaded into the transform hook as `workspace`. esbuild's stdin transform only needs a cwd preopen that EXISTS in the sync VFS mirror (`esbuild-binding.ts:60-66`, ADR-0049); a single-file type-strip does not resolve relative imports through esbuild (rifty's resolver does that), so per-package cwd is unnecessary. Pass `workspace = opts.workspace ?? opts.cwd ?? '/workspace'`.
- **Alternatives:** Per-file package root (`resolved.packageRoot`, `resolver.ts:15/433`) as the workspace — more 'correct' but pointless for a typestrip-only transform and would multiply preopen churn; esbuild is not doing module resolution here. A fixed `'/workspace'` literal — fine for the harness but couples the loader to a magic path; using `opts.cwd` is more honest.
- **Trade-offs:** Single root is simplest and matches the vite precedent (`real-vite-smoke` uses `ROOT='/workspace'` as both cwd and esbuild workspace, `real-vite-smoke.ts:42,120`). Risk: if a transform ever needed file-relative resolution (e.g. esbuild bundling, not the case here) the single root would be wrong — out of scope for type-strip.
- **Reversibility justification:** Internal wiring of an existing optional field into an existing call; no new public API beyond the hook already classified above; <15 lines. Rule 5.
- **Open question:** Q-2026-05-30-203

## Interface contract

```ts
// @rifty/runtime-js — module-loader/loader.ts (PUBLIC, re-exported via src/index.ts)
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
//   const { transformWithEsbuild, loadVendoredEsbuildWasm } from '@rifty tools/shadow-registry'
//   const wasm = loadVendoredEsbuildWasm();
//   createModuleLoader(fsSync, { cwd: ROOT, workspace: ROOT,
//     transformSource: ({source,loader,workspace}) =>
//       transformWithEsbuild(runWasi, wasm, { source, loader, workspace, format:'esm', jsx: loader!=='ts'?'automatic':undefined })
//         .then(r => r.code) });
```

## Affected packages & seams

**Affected packages:**

- `packages/runtime-js`
- `tools/shadow-registry`
- `tests/integration`

**Seam anchors:**

- `packages/runtime-js/src/module-loader/loader.ts:11`
- `packages/runtime-js/src/module-loader/loader.ts:50`
- `packages/runtime-js/src/module-loader/loader.ts:82`
- `packages/runtime-js/src/module-loader/esm.ts:39`
- `packages/runtime-js/src/module-loader/esm.ts:22`
- `packages/runtime-js/src/module-loader/resolver.ts:25`
- `packages/runtime-js/src/module-loader/resolver.ts:231`
- `packages/runtime-js/src/module-loader/resolver.ts:437`
- `tools/shadow-registry/src/esbuild-binding.ts:115`
- `tools/shadow-registry/src/esbuild-binding.ts:55`
- `tests/integration/fixtures/real-vite-smoke.ts:107`
- `packages/runtime-js/src/index.ts:4`

## Dependencies

**Depends on:**

- `01-load-opencode-into-vfs`

**Blocker proximity:** FAR from the hard blockers and squarely on the feasible side. This feature only strips types and lowers JSX at import time via the already-proven WASI esbuild binary (ADR-0047/0049) — no process spawn, no PTY, no native SQLite, no file watching. It deliberately does NOT touch the three import-time fatals owned by sibling features: it does not register or shim `node:sqlite`/`bun:sqlite`/`#db` (feature 03/04), does not add a `'bun'` resolver condition (`resolver.ts:231` stays `[node,default,import,require]` — that is feature 03's call), and does not stub `#pty` (feature 04). It stays on the feasible side by being purely syntactic/transformational: the same `.ts` graph that Node-with-a-stripper would parse, rifty now parses too. The nearest blocker-adjacency is that getting the WHOLE opencode graph to load will, the moment `session.ts` is reached, hit the `node:sqlite`/`#db` wall — but that wall is explicitly out of THIS feature's scope (dependsOn 01 for VFS contents; 03/04 must land before the full tree loads). For P0 acceptance this feature is validated on a curated safe subset that imports no sqlite/pty, keeping it strictly inside the ceiling.

## Test strategy

Levels:

1. **PARITY (gold standard)** — add a parity-runner case: a tiny multi-file `.ts` package graph (`a.ts` imports type+value from `b.ts`, `b.ts` re-exports an enum/interface and a const) loaded through `createModuleLoader` with the real esbuild transform hook, diff its runtime stdout against Node-run equivalent `.ts` (Node via `tsx`/`--experimental-strip-types`) — proves type-stripping + cross-file import order match Node semantics. Parity runs sandbox-disabled per project convention (network not needed here, but the runner harness is the same).
2. **UNIT (runtime-js)** — resolver: `foo.ts` resolves when `foo.js` absent; `foo.js` still wins when BOTH `foo.js` and `foo.ts` exist (the Node-deviation guard from decision 2); `index.ts` resolves as a directory index; `.ts` in a `type:module` scope classifies ESM, in a non-module scope CJS. `detectKind` unit cases.
3. **UNIT** — `esm.ts`: a `.ts` module with no `transformSource` configured throws the directed `'TS transform not configured'` error (no silent stub assertion); with a stub `transformSource` that strips a marker, the stripped output is what reaches `transformEsm`.
4. **CONFORMANCE** — re-run the existing module-loader conformance suite to prove `.js`/`.mjs`/`.cjs`/`.json` behaviour and the existing vite path are byte-unchanged (regression guard for the resolver extension-list edit).
5. **INTEGRATION (the smallest opencode slice)** — fork `real-vite-smoke.ts` into an opencode-ts-graph smoke that installs a SMALL real TS package subgraph (or vendors 3-4 opencode `.ts` files with only safe imports — no `#db`/`#pty`) and asserts `loader.import` resolves and executes them; this is the P0 acceptance signal but is gated by features 01 (load opencode into VFS) and 03/04 for the full tree, so the integration case here uses a curated safe subset.

Each test maps to a specific failure mode: `SYNTAX_ERROR` on TS (no strip), `MODULE_NOT_FOUND` on `.ts` (no extension), wrong kind (CJS-on-ESM), silent pass-through (no-hook stub), and Node-ordering deviation (`.js` vs `.ts`).

## Implementation plan (test-first)

1. **T1 — Resolver: `.ts`/`.tsx` as first-class resolvable extensions + index files, classified by package scope.** (kind: conformance)
   Extend `DEFAULT_EXTENSIONS` (`resolver.ts:25`) to `['.js','.mjs','.cjs','.ts','.tsx','.json']` — `.js` family FIRST so plain-Node packages that ship `foo.js` are byte-unchanged, `.ts`/`.tsx` before `.json`. Extend `INDEX_FILES` (`resolver.ts:26`) with `'index.ts'`,`'index.tsx'` in the same relative order. Extend `detectKind` (`resolver.ts:437`) so a `.ts`/`.tsx` file classifies as `'esm'` when its nearest package scope is `type:module` (reusing the `findPackageScope` branch at `resolver.ts:441-444`), else `'cjs'`. This is the resolve-side half of the feature; the transform-side (T2/T3) is separate so a `.ts` can resolve even with no transform configured (it then throws a directed error at execute time, never a silent stub).
   - **FAILING test to write first:** Add to `tests/conformance/modules/resolver.test.ts` a new `describe('TS extension resolution')`: (a) `it('resolves foo.ts when foo.js is absent')` — require/resolve `'./foo'` lands on `/app/foo.ts`; (b) THE NODE-DEVIATION GUARD `it('prefers foo.js over foo.ts when both exist')` — fixture has BOTH `/app/foo.js` and `/app/foo.ts`, `resolver.resolve('./foo',...).id` MUST end `.js`; (c) `it('resolves a directory via index.ts')` — `'./dir'` with only `/app/dir/index.ts` resolves; (d) `detectKind` cases: `/p/a.ts` under a `{"type":"module"}` package.json => kind `'esm'`, `/q/b.ts` under a package.json WITHOUT type:module => kind `'cjs'`. All four must FAIL first (today `.ts` is not in `DEFAULT_EXTENSIONS` so (a)(c) `MODULE_NOT_FOUND`, and `detectKind` returns `'cjs'` for any `.ts` so (d)-esm fails).
   - **Files:** `packages/runtime-js/src/module-loader/resolver.ts`, `tests/conformance/modules/resolver.test.ts`

2. **T2 — Public option surface: add the two optional fields to `ModuleLoaderOptions`.** (kind: unit)
   Add `readonly workspace?: string` and `readonly transformSource?: TransformSourceHook` to `ModuleLoaderOptions` (`loader.ts:11`), and export the new `TransformSourceHook` type. Thread `workspace = opts.workspace ?? opts.cwd ?? STUB_FROM_FILE_DEFAULT` and `transformSource` into the `deps` object built in `createModuleLoader` (`loader.ts:55-103`) so the esm path (T3) can read them. Re-export `TransformSourceHook` from `module-loader/index.ts` (it already exports `ModuleLoaderOptions`). NO behaviour change yet: `createModuleLoader` still works with zero new fields; loader gains no new package import edge (the hook is injected by the caller). This is the IRREVERSIBLE public-API decision (design decision 1) and is the ratification gate.
   - **FAILING test to write first:** Add `packages/runtime-js/src/module-loader/loader-transform.test.ts` :: `it('passes workspace and transformSource through to the esm execute path')` — construct `createModuleLoader(vfs, { cwd:'/work', workspace:'/work', transformSource: spy })` where the fixture has `/work/main.ts` importing `/work/dep.ts`; spy records every `{id,loader,workspace}` it is called with and returns the source with a sentinel `'/*X*/'` stripped. Assert the spy was invoked for BOTH `main.ts` and `dep.ts` with `loader:'ts'` and `workspace:'/work'`. Fails first: `ModuleLoaderOptions` has no `transformSource`/`workspace` field (TS compile error) — that compile failure IS the red state for the option-surface contract.
   - **Files:** `packages/runtime-js/src/module-loader/loader.ts`, `packages/runtime-js/src/module-loader/index.ts`, `packages/runtime-js/src/module-loader/loader-transform.test.ts`

3. **T3 — `esm.ts` strip step.** (kind: unit)
   Add `transformSource?: TransformSourceHook` and `workspace: string` to `EsmLoaderDeps` (`esm.ts:8-13`). In `executeEsm` (`esm.ts:39`), BEFORE the `transformEsm` call: if `resolved.id` ends with `.ts`/`.tsx`/`.jsx`, derive loader from extension (`.ts`->`'ts'`, `.tsx`->`'tsx'`, `.jsx`->`'jsx'`; design decision 3 — extension-only, `jsx:'automatic'` chosen at the CALLER not here), then if `deps.transformSource` is present set `source = await deps.transformSource({ source: resolved.source, id: resolved.id, loader, workspace: deps.workspace })`; if a `.ts`/`.tsx`/`.jsx` module is reached and `deps.transformSource` is ABSENT, throw a directed `ModuleLoadError('SYNTAX_ERROR'-class or NotImplementedError)` message `TS transform not configured for <id>` (NO silent stub). Then feed the (possibly stripped) source to `transformEsm(source, resolved.id)` exactly as today. Wire `deps.workspace`/`transformSource` from `loader.ts` deps (T2).
   - **FAILING test to write first:** Add `packages/runtime-js/src/module-loader/esm.test.ts` (new) :: (a) `it('throws a directed error when a .ts module is executed with no transformSource')` — loader with NO `transformSource`, fixture `/work/main.ts` containing `export const x: number = 1`, `await loader.import('./main.ts',...)` rejects with message matching `/TS transform not configured/` (NOT a `SYNTAX_ERROR` from acorn, NOT a silent pass); (b) `it('feeds stripped source to transformEsm')` — a stub `transformSource` that returns the source with `: number` removed; assert `loader.import` resolves and the module's exported `x === 1` (proves the stripped output is what acorn parsed). Both fail first: (a) today reaches acorn and throws `SYNTAX_ERROR` with the wrong message; (b) the strip hook does not exist so TS hits acorn and throws.
   - **Files:** `packages/runtime-js/src/module-loader/esm.ts`, `packages/runtime-js/src/module-loader/esm.test.ts`

4. **T4 — CJS `.ts` honesty: loud directed throw.** (kind: unit)
   In `loader.ts` `require()` and `deps.loadSync`, when a resolved module is `kind:'cjs'` but its id ends with `.ts`/`.tsx`, throw a directed `NotImplementedError('module-loader.ts-via-require')` with message explaining the esbuild hook is async-only and `require()` of `.ts` is unsupported on the facade path (design decision 1 alt C — opencode is `type:module` so this never arises on the happy path, but it must be loud not silent). Register this limitation in the compat-matrix as not-supported. The `.ts`->esm happy path is unaffected.
   - **FAILING test to write first:** Add to `packages/runtime-js/src/module-loader/loader-transform.test.ts` :: `it('require() of a .ts module throws a directed NotImplementedError, never silently new-Functions TS')` — fixture `/work/legacy.ts` under a NON-module package.json (so `detectKind`=>cjs), `loader.require('./legacy.ts','/work/e.js')` throws `NotImplementedError` with `/require\(\) of .*\.ts/` in the message. Fails first: today the unknown-extension cjs path would feed TS to `executeCjs`/`new Function` and throw an opaque syntax error (or worse, partially run).
   - **Files:** `packages/runtime-js/src/module-loader/loader.ts`, `packages/runtime-js/src/module-loader/cjs.ts`, `docs/compat/`, `packages/runtime-js/src/module-loader/loader-transform.test.ts`

5. **T5 — Loader-internal transform cache (design decision 4, REVERSIBLE Q-2026-05-30-202).** (kind: unit)
   Inside `createModuleLoader` add a `Map<string,string>` keyed by absolute resolved id, populated lazily on first `transformSource` call, read before re-invoking the hook, and cleared by the existing `invalidate(id)` path (`loader.ts:144` -> `registry.invalidate`). Wrap `deps.transformSource` so `esm.ts` is unaware of caching. Mark `TODO(ADR): Q-2026-05-30-202`. This avoids re-spawning the WASI esbuild process for the same module across the large opencode graph and across repeated harness runs in one loader instance.
   - **FAILING test to write first:** Add to `packages/runtime-js/src/module-loader/loader-transform.test.ts` :: `it('transforms each .ts id at most once across repeated imports, and drops the cache on invalidate')` — `transformSource` is a counting spy; import the same `/work/main.ts` twice via `loadById`/`import`, assert spy call count for `main.ts === 1`; then `loader.invalidate('/work/main.ts')`, import again, assert count `=== 2`. Fails first: no cache exists so count is 2 after the first repeat (or the registry already memoises the executed module, in which case the test asserts the TRANSFORM-level cache specifically by invalidating and re-importing). If registry memoisation already yields count 1 without a transform cache, the invalidate-then-reimport leg (expecting a 2nd transform) is the part that fails first.
   - **Files:** `packages/runtime-js/src/module-loader/loader.ts`, `packages/runtime-js/src/module-loader/loader-transform.test.ts`, `OPEN_QUESTIONS.md`

6. **T6 — Parity-runner harness extension (prerequisite for the gold-standard parity case T7).** (kind: harness)
   Add a TS kind to the runner: `types.ts` `ParityCase.kind` gains `'ts-esm'`. `run-in-node.ts` (`run-in-node.ts:36`) writes the entry as `main.ts` (and any setup `.ts` files keep their names) and spawns `process.execPath` on it — Node v24 strips types by default (verified: only `--no-experimental-strip-types` exists), so no extra flag needed; if a parity run on a non-v24 Node is detected, fall back to the vendored `tsx` (`node_modules/.bin/tsx`). `run-in-rifty.ts` (`run-in-rifty.ts:28,52`) writes `main.ts` for kind `'ts-esm'` and constructs `createModuleLoader(vfs, { cwd:'/work', workspace:'/work', transformSource })` where `transformSource` calls `transformWithEsbuild(runWasi, loadVendoredEsbuildWasm(), { source, loader, workspace, format:'esm', jsx: loader!=='ts'?'automatic':undefined }).then(r=>r.code)` — injecting `runWasi` from `@rifty/runtime-wasi` (allowed: the parity runner is a `tools/` harness, not a package, so it may depend on runtime-wasi + shadow-registry without violating layer rules). This is a HARNESS task: its 'test' is that the existing parity suite still passes AND a trivial new `ts-esm` smoke case runs green on both sides.
   - **FAILING test to write first:** Add `tools/node-parity-runner/cases/modules/ts-strip-smoke.case.ts` (kind:`'ts-esm'`) with a single-file `const x: number = 41; console.log(x + 1)` and expected `'42'`. Run `pnpm test:parity` (sandbox-disabled per convention): it FAILS first because (a) `types.ts` rejects kind `'ts-esm'`, (b) `run-in-rifty` writes `main.js` and feeds TS to acorn -> `SYNTAX_ERROR`, (c) `run-in-node` writes `main.js` (wrong ext, no strip). The case going green proves the runner threads the real esbuild hook end-to-end.
   - **Files:** `tools/node-parity-runner/src/types.ts`, `tools/node-parity-runner/src/run-in-node.ts`, `tools/node-parity-runner/src/run-in-rifty.ts`, `tools/node-parity-runner/cases/modules/ts-strip-smoke.case.ts`

7. **T7 — GOLD-STANDARD parity case (testStrategy level 1).** (kind: parity)
   A multi-file `.ts` package graph proving type-stripping + cross-file ESM import order match Node-with-a-stripper. `b.ts` exports an interface (type-only, must vanish), an enum, and a const value; `a.ts` imports the type (erased) and the value from `b.ts` and prints a computed result that depends on cross-file load order. The same source runs in Node v24 (strip-types) and in rifty (esbuild hook via T6) and stdouts are diffed. This is the P0 'TS-on-import across the tree' acceptance signal at the unit-of-language level, independent of opencode VFS contents.
   - **FAILING test to write first:** Add `tools/node-parity-runner/cases/modules/ts-graph-cross-file.case.ts` (kind:`'ts-esm'`, `setup.files: { 'b.ts': '<enum Color { R, G } export interface Box{n:number} export const base: number = 40; export { Color }>', 'a.ts': '<import { base, Color, type Box } from "./b.ts"; const box: Box = { n: 2 }; console.log(base + box.n + Color.G)>' }`, code imports `'./a.ts'`). Expected stdout `'43'`. Diff Node vs rifty. FAILS first until T1+T2+T3+T6 land: rifty either `MODULE_NOT_FOUND` on `.ts` (no extension) or `SYNTAX_ERROR` on the interface/enum (no strip); Node prints 43, rifty diverges => parity fail.
   - **Files:** `tools/node-parity-runner/cases/modules/ts-graph-cross-file.case.ts`

8. **T8 — Regression guard for the resolver extension-list edit.** (kind: conformance)
   Re-run the existing module-loader conformance + the existing real-vite path to prove `.js`/`.mjs`/`.cjs`/`.json` behaviour and the vite `transformRequest` path are byte-unchanged after `.ts`/`.tsx` entered `DEFAULT_EXTENSIONS`/`INDEX_FILES`. No new resolver behaviour is asserted here beyond 'plain-JS packages resolve identically' — the new `.ts` behaviour is covered by T1. This catches the risk called out in design decision 2: a package shipping both `source.ts` and `build.js` must still pick `.js`.
   - **FAILING test to write first:** Add `tests/conformance/modules/resolver.test.ts` :: `it('a package that ships both index.ts and index.js still resolves index.js (Node parity)')` — `node_modules/lib` with BOTH `index.ts` and `index.js` and NO exports field, `require('lib')` returns the `.js` export. Then run the full `pnpm test:conformance` + the existing `tests/integration` vite live run (sandbox-disabled) as the regression gate. The new sub-test fails first if `.ts` were ordered before `.js` in `INDEX_FILES`; the suite run guards against accidental kind/ordering drift.
   - **Files:** `tests/conformance/modules/resolver.test.ts`

9. **T9 — Curated opencode `.ts` subgraph integration smoke (testStrategy level 5 — the P0 acceptance for THIS feature, scoped to the safe subset).** (kind: integration)
   Fork `tests/integration/fixtures/real-vite-smoke.ts` into an `opencode-ts-graph-smoke.ts` that mounts 3-4 hand-vendored opencode-style `.ts` files (`type:module` package.json, internal relative + `#`-condition imports that resolve to `.ts` targets, e.g. a `#tool/x` -> `./src/x.ts`), with NO `#db`/`#pty`/`bun:sqlite` imports (those are features 03/04). Build the loader with the esbuild `transformSource` hook (same wiring as T6/`real-vite-smoke`). Assert `loader.import` resolves and EXECUTES the entry, printing `RIFTY_TS_GRAPH_OK`. Runs under `tsx` in a separate process (it replaces `globalThis.process`), driven by an opt-in `.test.ts` that spawns it (mirroring `vite-live-run.opt-in.test.ts`). NOTE: a full real-opencode-from-VFS run depends on feature 01 (load opencode into VFS); this smoke uses a curated safe subset to stay inside the ceiling and not block on 01/03/04.
   - **FAILING test to write first:** Add `tests/integration/opencode-ts-graph.opt-in.test.ts` that spawns the new fixture under `tsx` and asserts the child prints `'RIFTY_TS_GRAPH_OK'` and exits 0. Fails first: the fixture does not exist and, before T1-T3, the curated `.ts` files would `MODULE_NOT_FOUND` (no `.ts` ext) / `SYNTAX_ERROR` (no strip). Each failure mode (resolve, strip, `#`-condition-to-`.ts`) maps to a concrete assertion in the spawned child's log.
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

// ── packages/runtime-js/src/module-loader/loader.ts (T2/T5: PUBLIC option surface — IRREVERSIBLE, re-exported via module-loader/index.ts and the @rifty/runtime-js/loader subpath)
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
//   const transformCache = new Map<string,string>();              // T5, TODO(ADR): Q-2026-05-30-202
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
import { runWasi } from '@rifty/runtime-wasi';
import { transformWithEsbuild, loadVendoredEsbuildWasm } from '../../shadow-registry/src/index.ts';
const wasm = loadVendoredEsbuildWasm();
const transformSource = (req: {source:string; loader:'ts'|'tsx'|'jsx'; workspace:string}) =>
  transformWithEsbuild(runWasi, wasm, { source: req.source, loader: req.loader, workspace: req.workspace, format: 'esm', jsx: req.loader !== 'ts' ? 'automatic' : undefined }).then(r => r.code);
// kind 'ts-esm': files[`/work/main.ts`] = code; createModuleLoader(vfs, { cwd:'/work', workspace:'/work', transformSource });
// await loader.import('./main.ts', '/work/__entry.ts');
```

### Risks

- **Node-resolution DEVIATION:** rifty will now resolve bare `.ts` where Node (without a stripper config) does not. T1's both-exist guard keeps `.js` winning, but a real npm package that ships ONLY a `.ts` (rare, e.g. some Bun-first packages) would now resolve+strip where Node would `MODULE_NOT_FOUND` — this is intentional for the opencode facade but is the part of design decision 2 that needs human sign-off; it cannot be made byte-identical to Node.
- **DECLARATION FILES (`*.d.ts`/`.d.cts`/`.d.mts`) must be excluded from candidate matching — CLOSED by F02-DTS-EXCLUDE.** T1 added `.ts`/`.tsx` to `DEFAULT_EXTENSIONS`/`INDEX_FILES` with NO declaration-file exclusion, so a target shipping only a `.d.ts` resolved it (relative `./foo.d` → `foo.d.ts` via `${base}.ts`; explicit `./foo.d.ts` via the `st.isFile` early return; a package whose `exports`/`main` names a `.d.ts`) — the strip-types path then fed types-only source to acorn and threw `SYNTAX_ERROR`. Node's own strip-types loaders deliberately skip `.d.ts`. The resolver now rejects any `*.d.ts`/`.d.cts`/`.d.mts` candidate at every file-acceptance point (resolves as if absent → `MODULE_NOT_FOUND`), staying surgical (a runnable sibling `foo.js` still wins). Conformance: `tests/conformance/modules/resolver.test.ts` `describe('declaration-file exclusion')`. NOTE: ADR-0053 (ratified, immutable) does not yet record this exclusion in its Deviation section; amending the immutable ADR is out of scope — a future superseding ADR or amendment note should fold the `.d.ts`-exclusion rule into ADR-0053's contract.
- **T6 lets the `tools/` parity runner import `@rifty/runtime-wasi` + shadow-registry.** This is layer-legal for a harness but means the parity suite now spawns the WASI esbuild process per `ts-esm` case — slower; verify the cache (T5) and a small case count keep `pnpm test:parity` within CI budget. If `esbuild.wasm` is not vendored, `loadVendoredEsbuildWasm()` throws and ALL `ts-esm` parity cases fail loudly (acceptable: directed error, run `scripts/fetch-esbuild-wasi.mjs`).
- **`transformEsm` (esm-ast.ts) currently parses the POST-strip JS with acorn;** if esbuild emits syntax acorn cannot parse (e.g. certain decorators/lowering), the existing `SYNTAX_ERROR` path fires with a confusing message. Mitigate by keeping `format:'esm'` and asserting in T3 that stripped output round-trips through `transformEsm`.
- **`jsx:'automatic'` is hardcoded at the caller for `.tsx`/`.jsx` (design decision 3).** The facade serve path is JSX-free so this is dead weight in P0, but if a KEPT opencode dep ships `.tsx` authored against classic runtime the automatic default lowers wrong — out of scope per the design, revisit if a kept package brings JSX (Q-2026-05-30-201).
- **T9 integration uses HAND-VENDORED opencode `.ts` files, not the real tree** (feature 01 owns VFS load; 03/04 own `#db`/`#pty`/`bun:sqlite`). The smoke proves the language/graph mechanism only; it MUST NOT import anything that trips the import-time sqlite/pty wall, or it leaves this feature's scope and fails for an unrelated reason.
- **The CJS `.ts` loud-throw (T4) assumes opencode `.ts` is always `type:module`.** If a vendored fixture `.ts` lands under a non-module scope it will hit `NotImplementedError` instead of loading — correct behaviour, but a fixture authoring footgun; T9 fixtures must carry `type:module` package.json.

### Estimate

3-4 evening-units. Breakdown: T1 resolver+conformance ~0.5; T2 option surface ~0.25 (blocked on ratification); T3 esm strip step ~0.5; T4 cjs loud-throw + compat ~0.25; T5 cache ~0.25; T6 parity-runner harness (both sides + runWasi wiring) ~1.0 (the heaviest, real WASI integration); T7 gold parity case ~0.25; T8 regression ~0.25; T9 curated opencode integration smoke ~0.75. Roughly half the effort is the parity-runner harness (T6) since it is the first time the runner drives the esbuild WASI binary.

### Ratification gate

**⚠️ BLOCKED until TWO irreversible decisions are ratified (both flagged needsHumanRatification in the design).**

1. **ADR-00NN 'TS-on-import transform hook on `ModuleLoaderOptions` (injected esbuild, async, extension-keyed)'** — adds `workspace?` and `transformSource?: TransformSourceHook` to the PUBLIC `ModuleLoaderOptions` of `@rifty/runtime-js` (reversibility rule 1: cross-package public API). The load-bearing contract is the `TransformSourceHook` request shape `{source,id,loader,workspace}`+`Promise<string>` return — must be ratified, not invented. This gates T2 (and therefore T3/T5/T6/T7/T9 which depend on the hook).
2. **ADR-00NN '.ts/.tsx as first-class resolvable+ESM module extensions (ordering relative to .js, type:module classification)'** — changes resolver `DEFAULT_EXTENSIONS`/`INDEX_FILES` + `detectKind`, observable cross-package behaviour that DEVIATES from Node (Node does not resolve bare `.ts`); spans `resolver.ts`+`esm.ts`+`loader.ts` (rule 1 + rule 4). The deviation (`.ts` resolving where Node would not, and the `.js`-wins ordering) needs human sign-off. This gates T1.

Next free ADR numbers are **0052/0053** (highest on disk is 0051).

REVERSIBLE sub-decisions (loader selection jsx default Q-2026-05-30-201, transform cache Q-2026-05-30-202, single workspace root Q-2026-05-30-203) need only `OPEN_QUESTIONS` entries + `TODO(ADR)` markers, no gate.

Until 0052 and 0053 are ratified this plan cannot start coding T1/T2; the test files (T1/T3/T7) may be written first as the red state since they are tests, not the irreversible change.
