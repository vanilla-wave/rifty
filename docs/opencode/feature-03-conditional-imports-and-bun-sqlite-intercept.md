# Feature 03-conditional-imports-and-bun-sqlite-intercept — Conditional #-import resolution + bun:sqlite specifier intercept

> Part of the opencode-in-rifty facade effort. Feasibility phase P0. Staged doc — NOT a ratified ADR.

## Summary

Make rifty's resolver able to LOAD the opencode module graph as far as the native-SQLite boundary, where feature 04 takes over with the real WASM shim. Three concerns, deliberately separated by reversibility:

**(A) `bun` import condition.** Add the `bun` import condition to the resolver so opencode's `#db`/`#pty` subpath `imports` map can be steered to its `bun` branch instead of silently landing on the `node` branch. This is a one-array change but its design intent is subtle: per DE-RISK unknown-1, BOTH branches of `#db` import an unregistered builtin (bun→`bun:sqlite`, node→`node:sqlite`), so adding `bun` alone does NOT unblock anything — it only gives feature 04 a single, predictable specifier (`bun:sqlite` + `drizzle-orm/bun-sqlite`) to intercept rather than two. Default position: prepend `bun` so opencode's intended driver wins; this is configurable per-load (see C) so non-opencode loads are unaffected.

**(B) Resolvable throw-on-use SQLite builtins.** Register `node:sqlite`, `bun:sqlite` (and, scoped to opencode, the bare `#pty` target) as RESOLVABLE THROW-ON-USE builtins, exactly mirroring how `@rifty/net` registers `https` as a loud-throw stub (`register-builtins.ts:17`, ADR-0010). This lets the createRoutes→session.ts→storage/db.ts→`#db` static graph RESOLVE (no MODULE_NOT_FOUND at resolve time, `resolver.ts:42-49`) so P0 graph-load and P2 layer-build can proceed; the connection only constructs lazily inside `Client()`/`init(dbPath)` on first query (DE-RISK: init is deferred, not at module eval), so a storage-free trivial route (P3) can boot. The throw fires only if storage is actually touched. NOTE: feature 04 REPLACES these throw-stubs with a real WASM-SQLite-backed `init`; this feature delivers only the resolvable-stub registration + the registration seam.

**(C) Plumbing.** How does a per-load choice of (i) extra conditions and (ii) a bare-specifier intercept table reach the resolver? Today `ModuleLoaderOptions` has only `cwd` (`loader.ts:11-14`) and `CONDITIONS` is module-level-const (`resolver.ts:231`); the intercept point `isBuiltinSpecifier` is a process-wide singleton in `@rifty/io` (`builtin-registry.ts:18`). Wiring a per-load conditions list + an opencode-specific `#`-override/bare-intercept table into the resolver crosses the public API of `@rifty/runtime-js` (a new `ModuleLoaderOptions.conditions` field and `createResolver` signature change) — IRREVERSIBLE by rule 1, surfaced for ratification. The throw-stub registration in (B) itself stays additive/REVERSIBLE because it reuses the existing `registerBuiltin` singleton from a side-effect module, just like net.

**Scope boundary:** this feature does NOT add sql.js/wa-sqlite (that NEW DEP is feature 04, IRREVERSIBLE by rule 2). It stops exactly at the seam where the graph resolves and storage access throws a clear ENOSQLITE-style error.

## Decisions (classified)

### Decision A — Add a `bun` entry to the resolver active-conditions list

- **Question:** Add a `bun` entry to the resolver CONDITIONS / activeConditions list so opencode's `#db`/`#pty` bun branch can be selected.
- **Classification:** REVERSIBLE
- **Chosen:** Add `bun` to the active-conditions list, PREPENDED before `node` (so for opencode it steers `#db` to `db.bun.ts` → `bun:sqlite`, giving feature 04 ONE canonical specifier to shim instead of `node:sqlite` + `bun:sqlite`). Gate it behind the per-load conditions option from decision C; default conditions for ordinary loads remain unchanged (no `bun`), so only an opencode-flavoured load opts in. Revert = delete the array entry + the default. Single file (`resolver.ts`), <20 lines, no new dep, no public-API change on its own (the array is internal; the opt-in is delivered by decision C), no ADR conflict.
- **Alternatives:**
  - (a) Append `bun` AFTER `node` (default condition order): for opencode this picks `db.node.ts` → `node:sqlite`, so feature 04 must shim `node:sqlite` + `drizzle-orm/node-sqlite`. Rejected as default because the node-sqlite driver (`node:sqlite` `DatabaseSync`) is newer/less battle-tested as a drizzle target than bun-sqlite; but kept as a trivially-flippable provisional.
  - (b) Always add `bun` globally (no opt-in): risk that some unrelated package ships a bun-only branch that then fails in rifty; rejected — scope the condition to the opencode load.
- **Trade-offs:** Prepending `bun` diverges from Node's own condition set (Node has no `bun`), so it is non-spec; acceptable because it is opt-in per load and matches opencode's actual `packageManager: bun` intent. The choice of bun-vs-node branch only changes WHICH specifier feature 04 intercepts; either is workable, so this is a low-stakes provisional that the synthesizer/feature-04 can flip after measuring which drizzle driver shims cleaner.
- **Reversibility justification:** One internal array + a default; revert is <20 lines in one file, no cross-package API, no new dep, no ADR conflict → rule 5 REVERSIBLE.
- **Proposed Q-id:** Q-2026-05-30-301

### Decision B — Handling unregistered native SQLite specifiers so the graph resolves

- **Question:** How should the unregistered native SQLite specifiers (`node:sqlite`, `bun:sqlite`) be handled so the opencode static graph RESOLVES at P0/P2 without a real DB?
- **Classification:** REVERSIBLE
- **Chosen:** Register `node:sqlite` and `bun:sqlite` as RESOLVABLE THROW-ON-USE builtins via the existing `registerBuiltin` singleton (`@rifty/io` `builtin-registry.ts:33`), in a new side-effect module that mirrors `packages/net/src/register-builtins.ts`. The factory returns an exports object whose `Database`/`DatabaseSync` constructors throw a clear `'SQLite native driver not available in browser realm; provided by WASM shim (feature 04)'` error, exactly like net's `https` loud-throw stub (ADR-0010). Resolve succeeds (`resolver.ts:42-49` no longer throws MODULE_NOT_FOUND), module-eval succeeds (`db.bun.ts`/`db.node.ts` only IMPORT the symbol; they call `new Database` lazily in `init()`), so P0 graph-load + P2 layer-build pass; touching storage throws loudly. Register from the opencode harness setup, NOT from runtime-js (preserves top-down layering).
- **Alternatives:**
  - (a) Do nothing and rely on feature 04's real WASM shim to register these names first: rejected because P0/P2/P3 milestones want to prove graph-load and a storage-free route BEFORE the heavyweight WASM dep lands; the throw-stub is the cheap de-risk.
  - (b) Return null/empty exports instead of throw-on-use: violates the 'no silent stubs' hard rule — a null `Database` would surface as a confusing downstream TypeError.
  - (c) Map the specifier to the WASM adapter now: that pulls in the new dep → IRREVERSIBLE, out of scope for this feature.
- **Trade-offs:** A throw-on-use stub means any code path that actually instantiates the DB at boot (not just imports it) would still crash at P2 — DE-RISK says init is deferred so this is fine, but if opencode ever eagerly constructs the connection during layer build, this stub is insufficient and feature 04's real shim becomes a P2 (not P4) prerequisite. The stub is explicitly a throwaway that feature 04 overwrites (`registerBuiltin` re-registration discards the cached namespace, `builtin-registry.ts:35`), so no migration cost.
- **Reversibility justification:** Pure additive registration through the existing public `registerBuiltin` singleton from a new side-effect module; no signature change, no new dep, no ADR conflict, <100 lines/2 files → rule 5 REVERSIBLE. (It also matches the established net/https precedent.)
- **Proposed Q-id:** Q-2026-05-30-302

### Decision C — How per-load conditions and intercept tables reach the resolver

- **Question:** How does a per-load choice of extra conditions (the `bun` opt-in) and a per-package `#`-override / bare-specifier intercept table reach the resolver, given `CONDITIONS` is a module const and `isBuiltinSpecifier` is a process-wide singleton?
- **Classification:** IRREVERSIBLE
- **Chosen:** **RECOMMENDED — awaiting ratification.** Extend `ModuleLoaderOptions` with an optional `conditions?: readonly string[]` field (`loader.ts:11-14`) that, when present, REPLACES the default active-conditions order inside `createResolver`, and thread it through `createResolver(vfs, { conditions })` into `activeConditions()`. Do NOT add a per-package `#`-remap table or a per-load bare-intercept registry in THIS feature: instead rely on the process-wide `registerBuiltin` singleton (decision B) for the bare specifiers, and rely on the existing native `imports`-field resolution (`resolver.ts:246-280` already honours `#`-imports against package.json) + the `bun` condition (decision A) for `#db`/`#pty` steering. This keeps the cross-package surface change minimal: ONE new optional field on `ModuleLoaderOptions` and ONE new optional arg on `createResolver`.

  > **⚠️ WARNING — IRREVERSIBLE, NEEDS HUMAN RATIFICATION:** this adds a public field to `ModuleLoaderOptions` and changes `createResolver`'s exported signature (rule 1). Do NOT implement the public `conditions` field speculatively. A human must ratify the public-API addition (or choose alternative (c) overlay) before T2/T3/T6-HALF-B begin.

- **Alternatives:**
  - (a) Add a richer `ModuleLoaderOptions.importsOverride: Record<package, Record<#spec, target>>` table so the harness can remap `#db` → a VFS-overlaid adapter file WITHOUT touching opencode's package.json: more flexible (lets feature 04 swap `#db` cleanly) but a larger, more opinionated public API and more code in the resolver's `#`-import path; defer until feature 04 proves it needs more than condition-steering.
  - (b) Keep `CONDITIONS` global-mutable and expose a `setConditions()` side-effect: rejected — global mutable state is a footgun across concurrent loads and contradicts the registry-singleton-is-fine-but-conditions-are-per-resolution intuition.
  - (c) Overlay a patched opencode package.json via the shadow-registry VFS overlay (`tools/shadow-registry` `esbuildShimFiles` pattern, `index.ts:158`) to hardcode `#db` → a shim path and avoid any resolver API change at all: ZERO public-API change (REVERSIBLE!), but couples the fix to a specific opencode package.json shape and is brittle across opencode versions. This is a genuine REVERSIBLE escape hatch worth surfacing — if the team prefers no API change, option (c) can carry P0/P2 entirely via overlay + decision B's throw-stubs, deferring the `ModuleLoaderOptions` change until a later feature actually needs programmatic conditions.
- **Trade-offs:** Option chosen adds permanent public surface to `@rifty/runtime-js` (every consumer's `createModuleLoader` call site sees the new field; the vite harness at `real-vite-smoke.ts:107` is unaffected since the field is optional). Option (a) is more future-proof for feature 04 but over-builds now. Option (c) avoids the API change but bets on opencode's package.json staying stable and pushes complexity into the shadow-registry data table. The make-or-break tension: feature 04 WILL need to redirect `#db` to a real adapter; if that redirect is best expressed as a condition (`bun` → a shimmed `db.bun.ts` overlaid in VFS) then decision A + option (c) suffice and NO resolver API change is ever needed — which would downgrade this whole decision to REVERSIBLE. Recommend ratifying the minimal `conditions` field ONLY if a later feature needs programmatic (non-overlay) condition control; otherwise prefer option (c) overlay and skip the API change.
- **Reversibility justification:** Adding `ModuleLoaderOptions.conditions` and changing `createResolver`'s signature touches the public API between packages (`apps/playground`, tests, npm-client harness all call `createModuleLoader`) → rule 1 IRREVERSIBLE. The alternative (c) overlay path is rule-5 REVERSIBLE, which is precisely why it is surfaced as a real option rather than a footnote.
- **Proposed ADR title:** ADR-00NN: Per-load module resolution conditions for `@rifty/runtime-js` (opt-in `bun` condition; `ModuleLoaderOptions.conditions` vs shadow-registry package.json overlay)

## Interface contract

```ts
// (A) resolver.ts — internal: activeConditions accepts an extra/replacement list.
// Default unchanged for ordinary loads.
function activeConditions(esm: boolean, extra?: readonly string[]): readonly string[];
// default ESM: ['node','import','default']; default CJS: ['node','require','default']
// when extra provided (opencode load): e.g. ['bun','node','import','default']

// (C) RECOMMENDED, needs ratification — new optional public field + createResolver arg:
export interface ModuleLoaderOptions {
  readonly cwd?: string;
  /** Override active import/export conditions for this loader (opt-in; e.g. ['bun',...]). */
  readonly conditions?: readonly string[]; // NEW (IRREVERSIBLE: public API of @rifty/runtime-js)
}
export function createResolver(vfs: FsSync, opts?: { conditions?: readonly string[] }): Resolver; // arg NEW

// (B) new side-effect module (mirrors packages/net/src/register-builtins.ts), imported by the opencode harness:
// tools/shadow-registry (or a harness-local module) calls:
import { registerBuiltin } from '@rifty/io';
registerBuiltin('sqlite', () => sqliteThrowStub);     // covers node:sqlite (resolver strips node: prefix)
registerBuiltin('bun:sqlite', () => sqliteThrowStub); // bare specifier; isBuiltinSpecifier matches the full name
// sqliteThrowStub shape (throw-on-use, NOT silent):
//   { Database: class { constructor(){ throw new Error('...WASM shim, feature 04') } },
//     DatabaseSync: class { constructor(){ throw ... } }, default: <same> }
// NOTE: 'bun:sqlite' as a registry key resolves because isBuiltinSpecifier(name) only checks `name in factories`
//   (builtin-registry.ts:38-41) and the resolver passes the raw specifier when it has no 'node:' prefix
//   (resolver.ts:40-41) — VERIFY this path admits a colon-bearing bare name; if not, that is an additional
//   tiny resolver tweak (still REVERSIBLE) to let isBuiltinSpecifier see 'bun:sqlite' verbatim.
```

## Affected packages & seams

**Affected packages:**

- `packages/runtime-js`
- `packages/io`
- `tools/shadow-registry`
- `tests/integration`

**Seam anchors:**

- `packages/runtime-js/src/module-loader/resolver.ts:231`
- `packages/runtime-js/src/module-loader/resolver.ts:234`
- `packages/runtime-js/src/module-loader/resolver.ts:40`
- `packages/runtime-js/src/module-loader/resolver.ts:61`
- `packages/runtime-js/src/module-loader/resolver.ts:246`
- `packages/runtime-js/src/module-loader/loader.ts:11`
- `packages/runtime-js/src/module-loader/loader.ts:52`
- `packages/io/src/builtin-registry.ts:33`
- `packages/io/src/builtin-registry.ts:38`
- `packages/runtime-js/src/builtins/index.ts:59`
- `packages/net/src/register-builtins.ts:14`
- `tools/shadow-registry/src/index.ts:36`
- `tests/integration/fixtures/real-vite-smoke.ts:107`

## Dependencies

**Depends on:**

- `01-load-opencode-into-vfs`
- `02-ts-on-import-graph`

**Blocker proximity:** This feature sits DIRECTLY on the native-SQLite hard blocker ('Native SQLite as-is must be replaced by a WASM-SQLite shim, else import-time fatal') and stays on the feasible side by NOT implementing SQLite — it only makes the specifier RESOLVE (throw-on-use stub) so the import graph loads, then hands the real WASM replacement to feature 04. It deliberately stops short of the blocker: the moment any code constructs a `Database`, it throws a loud, documented error rather than faking results. It also brushes the PTY blocker via the `#pty` bun condition steering, but `#pty` is lazy-imported in opencode (DE-RISK: `const pty = lazy(()=>import('#pty'))`) so this feature does not need to register a `#pty` stub at all — pty only resolves at session-create time, which is feature 09's documented ceiling. Adding sql.js/wa-sqlite would CROSS the blocker into feature 04's IRREVERSIBLE new-dep territory and is explicitly excluded here. Closest decision to the blocker is decision B: if opencode eagerly constructs the DB during layer-build (contradicting DE-RISK's 'init is deferred' finding), the throw-stub is insufficient and feature 04's real shim is pulled forward to a P2 prerequisite — this is the single make-or-break assumption to re-verify when the real opencode graph is first loaded.

## Test strategy

Levels: unit (resolver) + parity (gold standard for Node-compatible resolution) + integration (graph-load harness).

1. **PARITY** (preferred, Node-compatible behavior): add a parity case for conditional `imports` resolution — a fixture package.json with an `#x` imports map carrying `{ bun, node, default }` branches; assert that with default conditions the resolver picks the node branch (matches Node) and with the opt-in `conditions:['bun',...]` it picks the bun branch. The default-conditions half MUST diff-match Node's actual `require('#x')`/`import '#x'` behavior (run under the parity runner). The bun half is rifty-specific (Node has no bun condition) so it is a unit assertion, clearly labelled non-parity.

2. **UNIT** (resolver): (a) `node:sqlite` and `bun:sqlite` resolve to `kind:'builtin'` (no MODULE_NOT_FOUND thrown at `resolver.ts:42`) once the throw-stub is registered; (b) loading the stub and constructing `Database`/`DatabaseSync` THROWS the clear ENOSQLITE-style error (proves no silent stub, CLAUDE.md hard rule); (c) without registration, resolve still throws MODULE_NOT_FOUND (guards against accidental global registration leaking into non-opencode loads).

3. **INTEGRATION** (graph-load): fork `tests/integration/fixtures/real-vite-smoke.ts` into an opencode-graph-load harness that builds a MINIMAL synthetic package.json imports map mimicking opencode's `#db` (`{bun:db.bun.ts,node:db.node.ts}`) plus a `db.bun.ts` that `import {Database} from 'bun:sqlite'`, registers the throw-stubs, sets `conditions:['bun','node','import','default']`, and asserts `loader.import` resolves the whole chain WITHOUT throwing at import time (proving P0 graph-load), while a fake `init()` that does `new Database()` throws (proving the boundary). Run sandbox-disabled per repo methodology if it ever touches live npm (this synthetic case does not need network).

No e2e for this feature (browser realm not exercised by resolution logic; SW bridge is feature 05/07).

## Implementation plan (test-first)

1. **T1 — PARITY baseline (`kind: parity`).** Lock down that rifty's existing `#`-imports resolution matches Node BEFORE touching the conditions logic. New parity case: a synthetic package.json with `type:module` and an imports map `{ "#x": { node: "./x.node.js", default: "./x.default.js" } }`, plus `x.node.js`/`x.default.js` each `console.log` a tag, and code that imports `'#x'` and prints the tag. With the DEFAULT (unchanged) conditions the resolver MUST pick the node branch — and the parity runner diffs rifty's stdout against real Node's actual `import '#x'` behavior. This is the regression baseline that proves adding the `bun` condition later does NOT change default behavior. No network.
   - **FAILING test first:** `tools/node-parity-runner/cases/modules/conditional-imports-node-branch.case.ts` — assert: code `import { tag } from '#x'; console.log(tag)` with setup.files package.json imports `{#x:{node:'./x.node.js',default:'./x.default.js'}}` prints `'X-NODE'` in BOTH Node and rifty (diff match). `kind:'esm'`. Fails today only if the runner can't mount a package.json with imports alongside the entry; if it passes immediately it is the green baseline guarding T2/T3.
   - **Files:** `tools/node-parity-runner/cases/modules/conditional-imports-node-branch.case.ts`

2. **T2 — `bun`-condition unit + `activeConditions` (`kind: unit`). ⚠️ BLOCKED on ratification (depends on ADR-00NN / decision A+C).** rifty-specific — Node has NO `bun` condition so this cannot be a parity case. Extend `activeConditions(esm, extra?)` so a caller-supplied conditions list REPLACES the default order, and add `bun` (PREPENDED) to the active list when opted in (decision A, Q-2026-05-30-301). Verify: with the synthetic `{ "#x": { bun, node, default } }` imports map, `createResolver(vfs, {conditions:['bun','node','import','default']}).resolve('#x',{esm:true})` resolves to the bun-branch file; with no conditions option it still resolves to node-branch (guard against the opt-in leaking globally). `resolveConditionTree` already iterates `activeConditions(esm)` so only the source list changes.
   - **FAILING test first:** `packages/runtime-js/src/module-loader/resolver.bun-condition.test.ts` — test 'opt-in bun condition picks the bun branch of #x': build memory VFS with package.json imports `{#x:{bun:'./db.bun.js',node:'./db.node.js',default:'./d.js'}}`, assert `createResolver(vfs,{conditions:['bun','node','import','default']}).resolve('#x',{fromFile:'/p/a.mjs',esm:true}).id` endsWith `'db.bun.js'`; AND test 'default conditions (no opt-in) still pick node branch' asserts `createResolver(vfs).resolve(...).id` endsWith `'db.node.js'`. RED before `activeConditions`/`createResolver` accept the list.
   - **Files:** `packages/runtime-js/src/module-loader/resolver.bun-condition.test.ts`, `packages/runtime-js/src/module-loader/resolver.ts`

3. **T3 — conditions threading through the public API (`kind: unit`). ⚠️ BLOCKED on ratification (decision C, IRREVERSIBLE rule 1 — public API).** Loader public surface: thread the new optional `ModuleLoaderOptions.conditions` field through `createModuleLoader` → `createResolver(vfs,{conditions})`. Default call sites (`real-vite-smoke.ts:107`, `apps/playground`, npm-client) are unaffected because the field is optional. Verify the field flows end-to-end: `createModuleLoader(vfs,{cwd,conditions:['bun',...]}).resolver.resolve('#x',...)` picks the bun branch. Add TSDoc on the new field. Update CHANGELOG for `@rifty/runtime-js`. MUST NOT begin until ADR-00NN ratifies the conditions-field-vs-overlay choice; if the human picks option (c) overlay, T3 is REPLACED by a shadow-registry package.json overlay task and the public API stays frozen.
   - **FAILING test first:** `packages/runtime-js/src/module-loader/loader.conditions.test.ts` — test 'createModuleLoader threads conditions into its resolver': assert `createModuleLoader(vfs,{cwd:'/p',conditions:['bun','node','import','default']}).resolver.resolve('#x',{fromFile:'/p/a.mjs',esm:true}).id` endsWith `'db.bun.js'`, and a loader built WITHOUT the field resolves `'#x'` to `db.node.js`. RED until `ModuleLoaderOptions` has `conditions` and `createModuleLoader` forwards it.
   - **Files:** `packages/runtime-js/src/module-loader/loader.conditions.test.ts`, `packages/runtime-js/src/module-loader/loader.ts`, `packages/runtime-js/CHANGELOG.md`

4. **T4 — SQLite throw-stub module (`kind: unit`). REVERSIBLE (decision B, Q-2026-05-30-302 — additive registration via existing `registerBuiltin` singleton; mirrors net/https precedent, ADR-0010).** New side-effect module that registers `node:sqlite` (key `'sqlite'`) and `bun:sqlite` (literal colon-bearing key `'bun:sqlite'`) as RESOLVABLE THROW-ON-USE builtins. The factory returns `{ Database, DatabaseSync, default }` whose constructors throw a clear NotImplementedError-style message (`'SQLite native driver not available in browser realm; provided by WASM shim — feature 04'`), exactly like `net/src/https.ts:notImpl`. NOT a silent stub (CLAUDE.md hard rule). Place under `tools/shadow-registry/src` (or a harness-local module imported by the opencode harness), NOT in runtime-js, to preserve top-down layering. Register compat-matrix entry: `bun:sqlite` / `node:sqlite` = not-supported (throw-on-use, real shim in feature 04).
   - **FAILING test first:** `tools/shadow-registry/src/register-sqlite-stub.test.ts` — test 'sqlite stub imports succeed but construction throws': import the side-effect module, then assert `loadBuiltin('node:sqlite')` returns an object with a `Database` property (import succeeds, NOT null), AND `new (loadBuiltin('node:sqlite').DatabaseSync)()` throws with message matching `/WASM shim|feature 04|not available/`; AND `new (loadBuiltin('bun:sqlite').Database)()` throws likewise. RED until the module exists and registers.
   - **Files:** `tools/shadow-registry/src/register-sqlite-stub.ts`, `tools/shadow-registry/src/register-sqlite-stub.test.ts`, `docs/compat/builtins.md`

5. **T5 — colon-bearing bare-key resolver round-trip (`kind: unit`). REVERSIBLE.** The make-or-break specifier-intercept verification from the interface contract NOTE: prove a colon-bearing bare specifier (`'bun:sqlite'`, NO `node:` prefix) is admitted by `isBuiltinSpecifier` and round-trips through resolve → id `'node:bun:sqlite'` → `loadBuiltin` strips only `'node:'` → factory key `'bun:sqlite'`. Verify (a) AFTER registering the T4 stub, `createResolver(vfs).resolve('bun:sqlite',{esm:true})` returns `kind:'builtin'` (no MODULE_NOT_FOUND at `resolver.ts:42`); (b) `resolve('node:sqlite',...)` also returns `kind:'builtin'`; (c) WITHOUT registration, `resolve('bun:sqlite',...)` THROWS MODULE_NOT_FOUND (guards against accidental global registration leaking into non-opencode loads). If the colon-key does NOT round-trip cleanly, this task surfaces the tiny REVERSIBLE resolver tweak needed (admit the verbatim colon name), <20 lines in `resolver.ts`. Depends on T4's stub being importable; throw-on-construct overlaps T4 but here the focus is the RESOLVE path and the negative (unregistered) case.
   - **FAILING test first:** `packages/runtime-js/src/module-loader/resolver.sqlite-intercept.test.ts` — three tests: 'unregistered bun:sqlite throws MODULE_NOT_FOUND' (before importing the stub module) asserts resolve throws ModuleLoadError code MODULE_NOT_FOUND; then after importing `register-sqlite-stub`: 'registered bun:sqlite resolves to kind:builtin' asserts `resolve('bun:sqlite',{fromFile:'/p/a.mjs',esm:true}).kind==='builtin'`; 'registered node:sqlite resolves to kind:builtin'. RED for the negative case proves no accidental global leak; RED for positive proves the colon-key intercept path.
   - **Files:** `packages/runtime-js/src/module-loader/resolver.sqlite-intercept.test.ts`

6. **T6 — integration graph-load harness (`kind: integration`).** Fork of `tests/integration/fixtures/real-vite-smoke.ts`. Builds a MINIMAL synthetic package.json mimicking opencode's `#db` imports (`{bun:'./db.bun.ts', node:'./db.node.ts', default:...}`) with `db.bun.ts` doing `import {Database} from 'bun:sqlite'` and a deferred fake `init()` that does `new Database()`. Two halves: **(HALF-A, UNBLOCKED)** with DEFAULT conditions the graph steers to `db.node.ts` whose `import {Database} from 'node:sqlite'` resolves against the T4 stub — assert `loader.import` resolves the WHOLE chain WITHOUT throwing at import time (proves P0 graph-load), while calling `init()` (which constructs `Database`) THROWS the documented boundary error (proves the seam). **(HALF-B, ⚠️ BLOCKED on ratification)** set `conditions:['bun','node','import','default']` so the chain steers to `db.bun.ts` → `bun:sqlite` stub; same assertions. No live npm (synthetic), so sandbox-disabled is NOT required. Prints `RIFTY_OPENCODE_GRAPHLOAD_OK` on success. This is the P0 milestone proof; HALF-B also pre-proves the deferred-init assumption.
   - **FAILING test first:** `tests/integration/opencode-graphload.opt-in.test.ts` (vitest spawner) → `tests/integration/fixtures/opencode-graphload-smoke.ts` (standalone tsx). Failing assertion FIRST: spawn the smoke script, assert it prints `'RIFTY_OPENCODE_GRAPHLOAD_OK'` and exits 0; inside the smoke script assert (1) `await loader.import('#db', root)` RESOLVES without throwing (P0 graph-load), and (2) calling the imported `init()` throws `/WASM shim|feature 04/`. HALF-A is RED until T4 stub + T1/T5 resolve path land; HALF-B stays skipped/RED until ratification unblocks T3's conditions field.
   - **Files:** `tests/integration/fixtures/opencode-graphload-smoke.ts`, `tests/integration/opencode-graphload.opt-in.test.ts`

### Scaffolding sketch

```ts
// (A) resolver.ts — activeConditions gains an optional replacement list; createResolver gains an opts arg.
// 'bun' is PREPENDED only when the caller opts in (decision A). Default order UNCHANGED.
function activeConditions(esm: boolean, extra?: readonly string[]): readonly string[] {
  if (extra && extra.length > 0) return extra;               // caller-supplied replaces default
  return esm ? ['node', 'import', 'default'] : ['node', 'require', 'default'];
}
// resolveConditionTree(node, esm) already loops `for (const cond of activeConditions(esm))`.
// Thread the list: createResolver(vfs, opts) closes over opts.conditions; resolveConditionTree reads it
// (capture in createResolver scope and pass down resolveExports/resolveImports/resolveConditionTree).
export interface ResolverOptions { readonly conditions?: readonly string[]; }   // NEW (internal)
export function createResolver(vfs: FsSync, opts?: ResolverOptions): Resolver;     // arg NEW

// (C) loader.ts — public surface change (IRREVERSIBLE rule 1; BLOCKED on ADR-00NN):
export interface ModuleLoaderOptions {
  readonly cwd?: string;
  /** Replace the active import/export conditions for this loader (opt-in; e.g. ['bun','node','import','default']).
   *  Omitted = Node-default order. See ADR-00NN. */
  readonly conditions?: readonly string[];                   // NEW PUBLIC FIELD
}
export function createModuleLoader(vfs: FsSync, opts: ModuleLoaderOptions = {}): ModuleLoader {
  const resolver = createResolver(vfs, { conditions: opts.conditions });          // CHANGED call
  // ...
}

// (B) tools/shadow-registry/src/register-sqlite-stub.ts — side-effect module, mirrors net/register-builtins.ts.
// Throw-on-USE (NOT silent). Imported by the opencode harness, NEVER by runtime-js (top-down layering).
import { registerBuiltin, NotImplementedError } from '@rifty/io';
function notAvailable(ctor: string): never {
  throw new NotImplementedError(
    `bun:sqlite.${ctor}`,
    'SQLite native driver not available in the browser realm; provided by the WASM-SQLite shim (feature 04)',
  );
}
const sqliteThrowStub = {
  Database: class { constructor() { notAvailable('Database'); } },
  DatabaseSync: class { constructor() { notAvailable('DatabaseSync'); } },
  default: undefined as unknown,
};
(sqliteThrowStub as { default: unknown }).default = sqliteThrowStub;
registerBuiltin('sqlite', () => sqliteThrowStub);       // covers node:sqlite (resolver strips 'node:' -> 'sqlite')
registerBuiltin('bun:sqlite', () => sqliteThrowStub);   // bare colon-key; isBuiltinSpecifier('bun:sqlite') === true

// VERIFIED resolve/load round-trip (drives T5): resolver.ts:40 isBuiltinSpecifier('bun:sqlite') true
//   -> L41 name='bun:sqlite' (no node: prefix) -> L42 still true -> L50 returns id 'node:bun:sqlite'
//   -> loader loadBuiltin('node:bun:sqlite') strips 'node:' -> 'bun:sqlite' -> factory hit. No core change expected;
//   T5 asserts this and only adds a <20-line resolver tweak IF the colon-key path is found broken.

// (T6) opencode-graphload-smoke.ts — fork of real-vite-smoke.ts (no live npm):
import '../../../tools/shadow-registry/src/register-sqlite-stub.ts'; // registers the throw-stubs
// synthetic /workspace/package.json { type:'module', imports:{ '#db':{ bun:'./db.bun.ts', node:'./db.node.ts' } } }
// db.node.ts: `import { Database } from 'node:sqlite'; export function init(){ return new Database(':memory:'); }`
// db.bun.ts:  `import { Database } from 'bun:sqlite';  export function init(){ return new Database(':memory:'); }`
// HALF-A (unblocked): const loader = createModuleLoader(fsSync, { cwd: ROOT });
//   const ns = await loader.import('#db', `${ROOT}/__entry__.mjs`);   // RESOLVES (P0 graph-load) — no throw
//   try { ns.init(); fail } catch (e) { assert /WASM shim|feature 04/.test(e.message) }  // boundary proven
// HALF-B (BLOCKED): createModuleLoader(fsSync, { cwd: ROOT, conditions:['bun','node','import','default'] });
//   same import + same boundary assertion (now via bun:sqlite stub). Skipped until ADR-00NN ratified.
// print('RIFTY_OPENCODE_GRAPHLOAD_OK'); realExit(0);
```

### Risks

1. **Ratification gate is the dominant schedule risk:** T2/T3 and T6-HALF-B cannot start until ADR-00NN settles the conditions-field-vs-overlay question (decision C, IRREVERSIBLE rule 1). If the human picks option (c) — shadow-registry package.json overlay — then T3 is DISCARDED entirely (no public API change), T6-HALF-B is driven by an overlaid package.json instead of the conditions field, and only A's `bun` default-order tweak in `resolver.ts` remains. Do NOT implement the public `conditions` field speculatively.
2. **Make-or-break assumption (DE-RISK unknown-1 / blockerProximity):** the throw-on-USE stub is only sufficient if opencode's storage init is DEFERRED (lazy, inside `Client()`/`init(dbPath)`), not constructed eagerly at layer-build. T6 only exercises a SYNTHETIC graph whose init defers by construction, so T6 GREEN does NOT prove the real opencode graph defers. When the real graph is first loaded (later feature), if `Database` is constructed during the ~40-layer build, this throw-stub is insufficient and feature 04's real WASM shim is pulled forward from P4 to a P2 prerequisite. T6 must be re-run against the real graph and this risk re-checked then.
3. **Colon-bearing builtin key (`'bun:sqlite'`) is an untested code path:** verified by reading `resolver.ts:40-50` + `builtin-registry.ts:38-44` that it round-trips (id becomes `'node:bun:sqlite'`, `loadBuiltin` strips only `'node:'`), but it has never been exercised. T5's negative+positive tests lock it; if broken, a <20-line resolver tweak (admit the verbatim colon name) is REVERSIBLE and stays in scope. Secondary check: `loadSync`/`readResolvedById` both gate on `startsWith('node:')`, which `'node:bun:sqlite'` satisfies — verified OK, but worth a regression assertion.
4. **Layering trap:** the sqlite throw-stub MUST live in `tools/shadow-registry` (or a harness-local module) and be imported only by the opencode harness — NEVER from `packages/runtime-js`. Registering from runtime-js would (a) violate top-down layering and (b) leak the intercept into ALL loads including non-opencode ones, breaking T5's 'unregistered throws MODULE_NOT_FOUND' guarantee and any package that legitimately expects `node:sqlite` to be MODULE_NOT_FOUND. The registry is a process-wide singleton (`builtin-registry.ts:17-18`), so test isolation matters: T5's negative case must run BEFORE any test in the same process imports the stub module, or the singleton must be reset between tests.
5. **`bun` as a non-spec condition:** prepending `bun` diverges from Node's condition set (Node has no `bun`). Acceptable because it is opt-in per load (decision A), but the bun-half of resolution can NEVER be a parity case (Node has no reference behavior) — hence T2 is unit-only and T1 covers the Node-matching default half. If a future non-opencode load accidentally passes `conditions:['bun',...]`, an unrelated package shipping a bun-only branch could pick an unintended file; mitigated by keeping the opt-in scoped to the opencode harness and defaulting to no `bun`.
6. **`#pty` is intentionally NOT stubbed in this feature** (lazy `const pty = lazy(()=>import('#pty'))` in opencode resolves only at session-create, feature 09's documented ceiling). If the real opencode graph turns out to STATICALLY import `#pty` on the minimal serve path (contradicting DE-RISK), graph-load fails and a `#pty` throw-stub must be added — small REVERSIBLE addition to T4's module, but it changes the P0 scope.

### Estimate

4-6 evening-units total. T1 (parity baseline) ~1; T2 (bun-condition unit + activeConditions) ~1 but BLOCKED on ratification; T3 (conditions threading through public API) ~1 BLOCKED; T4 (sqlite throw-stub module) ~1 REVERSIBLE; T5 (resolver round-trip unit for colon-bearing bare key) ~0.5 REVERSIBLE; T6 (integration graph-load harness) ~1.5 — its conditions-opt-in half is gated, but a node-branch-only variant can land unblocked. Critical path is the ratification gate: ~2-2.5 units (T2/T3/T6-full) blocked until ADR-00NN is ratified; ~2.5 units (T1, T4, T5, T6-node-variant) can proceed now.

### Ratification gate

**⚠️ BLOCKED (partial) until ADR-00NN is ratified:** "Per-load module resolution conditions for `@rifty/runtime-js` — opt-in `bun` condition via `ModuleLoaderOptions.conditions` + `createResolver(vfs, {conditions})` signature change, vs the shadow-registry package.json-overlay alternative (option c)."

This is design decision C, classification IRREVERSIBLE by Reversibility rule 1 (adds a public field to `ModuleLoaderOptions` and changes `createResolver`'s exported signature — consumed by `apps/playground`, npm-client harness `real-vite-smoke.ts:107`, and tests). Tasks T2, T3, and the conditions-opt-in half of T6 MUST NOT start until this is ratified; the human must choose between (i) the minimal `conditions` field, (ii) the richer `importsOverride` table, or (iii) the zero-API-change shadow-registry package.json overlay. Tasks T1, T4, T5 and the node-branch-only variant of T6 are REVERSIBLE and may proceed immediately. Decisions A (Q-2026-05-30-301, add `bun` to conditions list) and B (Q-2026-05-30-302, register throw-on-use sqlite builtins) are REVERSIBLE and logged in OPEN_QUESTIONS; only their delivery vehicle (the public conditions field) is gated.
