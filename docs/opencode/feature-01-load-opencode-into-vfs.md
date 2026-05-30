# Feature 01-load-opencode-into-vfs — Load opencode source + dependency tree into the VFS
> Part of the opencode-in-rifty facade effort. Feasibility phase P0. Staged doc — NOT a ratified ADR.

## Summary

This feature owns **ACQUISITION and PLACEMENT only**: getting the `anomalyco/opencode@dev` `packages/opencode/src` source plus the slice of its dependency tree needed for the programmatic `Server.listen` path into a memory VFS that a headless harness (forked from `tests/integration/fixtures/real-vite-smoke.ts`) can resolve against. It deliberately does **NOT** touch the resolver, TS-on-import, the `#db`/`#pty`/sqlite shims, or the HTTP bridge — those are features 02/03/04/05/06.

Three concrete problems to solve:

1. **WHERE opencode source comes from.** opencode is not vendored. Choice: vendor a PINNED snapshot of `packages/opencode/src` (+ its `package.json`) under `tests/integration/fixtures/opencode/` committed to the repo, fetched once by a checked-in script that pins a commit SHA. Rationale: the feasibility de-risk already quoted exact source files at `@dev`; reproducible offline test fixtures are the project's gold standard; cloning the live Bun monorepo at test time is non-deterministic and pulls TUI/web/SDK we prune anyway.

2. **HOW to get the dependency tree**, given opencode is a Bun monorepo (`packageManager bun@1.3.14`) with `workspace:` + `catalog:` protocol deps that ADR-0051's npm-centric installer (`packages/npm-client/src/installer.ts`) does not understand (grep confirms NO `workspace:`/`catalog:` handling in `npm-client/src`). Choice: do **NOT** teach the npm installer Bun protocols. Instead, produce a DERIVED npm-installable `package.json` (a "facade manifest") at fixture-build time that (a) resolves `catalog:` pins to the concrete versions from the workspace-root `package.json` catalog (effect `4.0.0-beta.66`, `@effect/platform-node` `4.0.0-beta.66`, `drizzle-orm` `1.0.0-rc.2`, `ai` `6.0.168`, `zod` `4.1.8`, `ulid` `3.0.1`, etc.), (b) drops `workspace:` deps (`@opencode-ai/*` are sibling source vendored alongside, resolved by path overlay not npm), and (c) PRUNES every dep not on the no-tool-execution serve path per the de-risk's KEEP/PRUNE list. Then `install()` runs against the existing npm path with that derived manifest.

3. **WHICH deps.** Encode the de-risk's pruned KEEP list (effect, `@effect/platform-node`, ai + used `@ai-sdk` providers, zod, ulid, remeda, decimal.js, partial-json, immer, gray-matter, jsonc-parser, semver, minimatch, ignore, glob, mime-types, htmlparser2, turndown, fuzzysort, `@standard-schema/spec`, drizzle-orm CORE, `@modelcontextprotocol/sdk`) as the facade-manifest dependencies; the PRUNE list (TUI `@opentui/*`, solid-js, `bun-pty`/`@lydell/node-pty`, `tree-sitter-*`, `@parcel/watcher*`, chokidar, octokit/gitlab/auth, ws, bonjour-service, opentelemetry) is simply omitted. `drizzle-orm/bun-sqlite` + node-sqlite drivers and `#db`/`#pty` are KEPT in source but their resolution is feature 03/04's job (not installed/shimmed here).

The deliverable is: `tests/integration/fixtures/opencode/` containing vendored src + original `package.json` + a generated `facade.package.json` + a build script (under `scripts/`), and a loader helper that overlays them into a memory VFS (mirroring how `real-vite-smoke.ts` overlays esbuild/rollup shim files at `request.ts`-style `fsSync.writeFileSync`). Success criterion for THIS feature: the install completes and the VFS contains the opencode src tree + `node_modules` for the KEEP set, such that feature 02's loader CAN attempt to resolve from `server/server.ts` (resolution success/failure of `#db` etc. is owned by 02/03/04).

## Decisions (classified)

### D1 — Vendor a pinned snapshot vs clone/install at test time

- **Question:** Vendor a pinned opencode source snapshot in-repo vs clone/install from a live source at test time?
- **Classification:** REVERSIBLE
- **Chosen:** Vendor a PINNED snapshot of `anomalyco/opencode@<SHA>` `packages/opencode/src` + its `package.json` under `tests/integration/fixtures/opencode/`, fetched by a checked-in one-shot script (`scripts/vendor-opencode.ts`) that records the SHA. Treat it as a test fixture, not a runtime dependency.
- **Alternatives:**
  - (a) `git clone anomalyco/opencode@dev` at test time and read `packages/opencode` — non-deterministic (dev branch moves), requires network in the sandbox, drags the whole Bun monorepo incl. pruned TUI/web/SDK.
  - (b) `npm install` the published `opencode` package — wrong artifact: the published tarball is a built CLI bundle, not the TS source graph we must drive via `Server.listen`, and the de-risk shows the CLI entry crashes at import.
  - (c) git submodule of the whole monorepo — heavy, and submodule + Bun toolchain is more than this fixture needs.
- **Trade-offs:** Vendoring is deterministic, offline, reviewable, and lets us commit ONLY the pruned serve-path src (smaller). Cost: manual refresh when chasing `opencode@dev`; mitigated by the pin script recording the SHA so refresh is one command. This is a test fixture, not shipped code, so staleness is low-risk.
- **Reversibility justification:** Touches only `tests/integration/fixtures/**` and `scripts/**`; no cross-package public API; no new runtime dependency (the script may shell out to git/curl which are dev-only and not bundled); does not contradict an ADR; revert is deleting a fixture directory. Fails all four IRREVERSIBLE triggers.
- **Tracking:** `Q-2026-05-30-101`

### D2 — Obtain an installable dependency tree from Bun `workspace:`/`catalog:` protocols

- **Question:** How to obtain an installable dependency tree from a Bun monorepo whose deps use `workspace:` and `catalog:` protocols that `packages/npm-client/src/installer.ts` cannot parse?
- **Classification:** REVERSIBLE
- **Chosen:** Generate a DERIVED "facade manifest" at fixture-build time (`scripts/vendor-opencode.ts` step): read `packages/opencode/package.json` + the workspace-root `package.json` `catalog`, resolve every `catalog:` dep to its concrete version, DROP every `workspace:` dep (the `@opencode-ai/*` siblings are vendored as source and overlaid by path, not installed), keep only the de-risk KEEP set, and emit a plain npm-style `package.json`. Feed THAT to the existing `install(name, version, deps, opts)` unchanged. The npm installer never sees a Bun protocol.
- **Alternatives:**
  - (a) Teach `packages/npm-client/src` to parse `workspace:`/`catalog:` — this edits cross-package install logic that ADR-0023/0042/0051 govern, is >100 lines across multiple files, and would be a permanent runtime feature for a one-off fixture; that crosses into IRREVERSIBLE and is the wrong layer.
  - (b) Run `bun install` to produce a real `node_modules`, then snapshot it into the VFS — requires the Bun toolchain on the build host and snapshots native binaries we must prune; brittle.
  - (c) Hand-write the facade manifest as static JSON — simplest but drifts silently from the vendored source's real deps; the generator keeps them in sync at refresh time.
- **Trade-offs:** Pre-resolving to a derived manifest keeps the Bun-specific knowledge OUT of the runtime installer (no ADR-0051 risk), is the minimal seam, and is auditable (the generated `facade.package.json` is committed and diffable). Cost: the catalog→version resolution and KEEP-filter live in the vendor script and must be re-run on refresh; acceptable for a fixture.
- **Reversibility justification:** No edit to `packages/npm-client` public API or internals; no new runtime dep; the catalog/workspace flattening is a build-time script over fixture data; revert = delete generated `facade.package.json`. Passes as REVERSIBLE.
- **Tracking:** `Q-2026-05-30-102`

### D3 — The prune boundary (which deps are required for `Server.listen` only)

- **Question:** Which deps are "required for the programmatic `Server.listen` path only" (the prune boundary)?
- **Classification:** REVERSIBLE
- **Chosen:** Adopt the de-risk `opencode-package-surface` KEEP/PRUNE/SHIM lists verbatim as the facade-manifest dependency set.
  - **KEEP:** effect, `@effect/platform-node`, ai + actually-used `@ai-sdk/*` providers (anthropic/openai/google), `@ai-sdk/provider`, zod, ulid, remeda, decimal.js, partial-json, immer, gray-matter, jsonc-parser, semver, minimatch, ignore, glob, mime-types, htmlparser2, turndown, fuzzysort, `@standard-schema/spec`, drizzle-orm (CORE query builder), `@modelcontextprotocol/sdk`. The `@opencode-ai/*` workspace pkgs are vendored as source siblings (overlaid by path).
  - **SHIM-not-install** (owned by features 03/04, NOT this feature): `#db`→WASM-SQLite, `drizzle-orm/bun-sqlite` + `drizzle-orm/node-sqlite` + `bun:sqlite` + `node:sqlite`, `#pty`.
  - **PRUNE** (omit from manifest): `@opentui/*`, solid-js, `@solid-primitives/*`, bun-pty, `@lydell/node-pty`, `tree-sitter-*`, web-tree-sitter, `@parcel/watcher*` + chokidar, which, cross-spawn, open, clipboardy, `@silvia-odwyer/photon-node`, `@zip.js/zip.js`, `@actions/*`, `@octokit/*`, `@gitlab/*`, `*-auth`, ws, vscode-jsonrpc, `@agentclientprotocol/sdk`, `@aws-sdk/*`, bonjour-service, `@opentelemetry/*` + `@effect/opentelemetry`, all devDeps (drizzle-kit, `@babel/core`, tsgo, prettier).
- **Alternatives:**
  - (a) Install the FULL dep tree and let ADR-0051's `assertNativeSupported` (`installer.ts` ~L502-520) throw `ENATIVEUNSUPPORTED` on natives — wastes install time, makes the failure mode "install aborts on `@parcel/watcher`" instead of a clean curated graph, and forces ordering games.
  - (b) Prune more aggressively (drop ai/`@ai-sdk` until P4) to get P0 graph-load faster — but the de-risk shows `session.ts` is on the `createRoutes` static graph and pulls these transitively, so under-pruning just trips later; the KEEP list is already minimal for the static graph.
- **Trade-offs:** Using the de-risk list directly is grounded in verified source (it quoted the import graph) and keeps the fixture honest. Cost: the `@ai-sdk` provider sublist is a judgement call (the de-risk says "anthropic/openai/google etc"); provisionally include those three and let the loader surface any missing-provider import as a concrete `MODULE_NOT_FOUND` for follow-up rather than guessing more.
- **Reversibility justification:** The prune list is fixture-manifest data, not code or API; adding/removing an entry is a one-line edit to a generated/committed JSON; no ADR conflict (ADR-0051 native policy still applies if anything native sneaks in). REVERSIBLE.
- **Tracking:** `Q-2026-05-30-103`

### D4 — How vendored sources land in the memory VFS at resolvable paths

- **Question:** How do the vendored `@opencode-ai/*` workspace siblings and the vendored opencode src get into the memory VFS so the loader can resolve `@/...` and bare `opencode/...` style imports?
- **Classification:** REVERSIBLE
- **Chosen:** Provide a fixture-loader helper (`tests/integration/fixtures/opencode/overlay.ts`, mirroring the esbuild/rollup overlay loop at `real-vite-smoke.ts:97-104`) that writes the vendored src tree under a workspace ROOT (e.g. `/workspace/node_modules/opencode/` for the package + `/workspace/node_modules/@opencode-ai/<pkg>/` for siblings) via `fsSync.mkdirSync`/`writeFileSync`, alongside each package's own `package.json` (so the resolver's exports `./*: ./src/*.ts` and imports `#db`/`#pty` maps are present for feature 02/03 to act on). The `@/` path alias inside opencode (TS paths) is resolved by feature 02's loader config, not invented here; this feature only guarantees the files + `package.json` land at resolvable `node_modules` locations.
- **Alternatives:**
  - (a) Mount the vendored dir as a real on-disk `node_modules` and point a node-fs VFS at it — couples the fixture to a host path layout and diverges from the memory-VFS pattern every other integration fixture uses.
  - (b) Bundle opencode src into one file first — defeats the whole point (we are testing multi-file TS-on-import graph loading, feature 02).
- **Trade-offs:** The `writeFileSync`-overlay-into-memory-VFS pattern is already proven (`real-vite-smoke` overlays shims exactly this way), keeps the fixture realm-independent and offline. Cost: we must place `package.json` files faithfully (esp. opencode's `imports` map for `#db`/`#pty` and `exports` `./*`) so downstream features see the real conditions; the vendor script copies them verbatim.
- **Reversibility justification:** New helper file lives in `tests/integration/fixtures/**`; uses only existing VFS APIs (`createMemoryFs`, `fsSync.writeFileSync` from `packages/vfs` already used by `real-vite-smoke.ts`); no new public API, no new dep, no ADR conflict. REVERSIBLE.
- **Tracking:** `Q-2026-05-30-104`

## Interface contract

No change to any package's public `src/index.ts`. All new surface is test-fixture/script-local:

`scripts/vendor-opencode.ts` (dev-only, not bundled):

```ts
// pins a commit, fetches packages/opencode/src + package.json + needed @opencode-ai/* sibling src,
// resolves catalog:/workspace: against the workspace-root catalog, emits the facade manifest.
interface VendorResult { sha: string; vendoredFiles: number; facadeManifest: PackageJsonLike }
function vendorOpencode(opts: { sha: string; outDir: string }): Promise<VendorResult>
```

`tests/integration/fixtures/opencode/facade.package.json` (generated, committed):

```jsonc
{ "name": "...", "version": "...", "type": "module", "dependencies": { /* KEEP set with concrete catalog-resolved versions */ } }
```

`tests/integration/fixtures/opencode/overlay.ts` (consumed by the headless harness, feature 06):

```ts
// Writes vendored src + package.json files into a memory VFS, mirroring real-vite-smoke.ts:97-104.
function overlayOpencodeSources(fsSync: FsSync, root: string): void
// Returns the dep map to hand to install(), read from facade.package.json.
function opencodeFacadeDeps(): Record<string, string>
const OPENCODE_PKG_DIR: string // e.g. '/workspace/node_modules/opencode'
const OPENCODE_SERVER_ENTRY: string // e.g. '/workspace/node_modules/opencode/src/server/server.ts'
```

Reuses existing APIs only: `install()` from `packages/npm-client` (`installer.ts:59` `InstallOptions`), `createMemoryFs`/`setSyncMirror`/`fsSync.writeFileSync` from `packages/vfs`, `RegistryClient` from npm-client.

## Affected packages & seams

**Affected packages:**
- `tests/integration` (fixtures + harness, primary)
- `scripts` (vendor-opencode pin/fetch/flatten script)
- `packages/npm-client` (CONSUMED unchanged via `install()`; NOT modified)
- `tools/shadow-registry` (pattern reference for overlay-into-VFS; not modified by this feature)

**Seam anchors:**
- `tests/integration/fixtures/real-vite-smoke.ts:97-104` (overlay-shim-files-into-`fsSync` loop — the exact pattern `overlay.ts` forks)
- `tests/integration/fixtures/real-vite-smoke.ts:56-94` (`createMemoryFs` + `setSyncMirror` + write `package.json` + `install()` — the harness skeleton to fork)
- `packages/npm-client/src/installer.ts:59-72` (`InstallOptions` / `install()` entry — consumed unchanged with the facade manifest)
- `packages/npm-client/src/installer.ts:502-520` (ADR-0051 `assertNativeSupported` — the prune list is designed to never reach this throw)
- `packages/runtime-js/src/module-loader/resolver.ts:231-236` (`CONDITIONS` array, no `'bun'` — informs WHY catalog/workspace must be pre-flattened and why `#db` lands on node-condition; resolution itself is feature 02/03)
- `tools/shadow-registry/src/index.ts:158-161` (`esbuildShimFiles` overlay table — structural precedent for the vendored-files map)

## Dependencies

**Depends on:** (none)

**Blocker proximity:** Sits one hop from THREE hard blockers but stays on the feasible side by NOT installing/executing them, only placing files.

1. **Native SQLite:** the vendored src keeps `storage/db.bun.ts` (`bun:sqlite`) and `db.node.ts` (`node:sqlite`) verbatim and keeps drizzle-orm CORE in the manifest, but does NOT install the bun-sqlite/node-sqlite drivers as runnable and does NOT resolve `#db` — that is feature 03/04's WASM-SQLite shim; this feature only guarantees the files are present so the shim has something to intercept.
2. **PTY:** `pty.bun.ts`/`pty.node.ts` source is vendored but `bun-pty`/`@lydell/node-pty` are PRUNED from the manifest (never installed); the lazy `import('#pty')` means no import-time crash, and throw-on-create is feature 04.
3. **Process-spawn tools** (`Git.run`/ripgrep/bash): which/cross-spawn/`tree-sitter-*` are PRUNED from the manifest, so the spawn-based tool deps never enter the VFS.

The prune list is also tuned to never hit ADR-0051's `assertNativeSupported` throw (`installer.ts:502-520`) by omitting `@parcel/watcher*` and other natives up front. Net: this feature designs TO the blockers (curate them out / leave inert source for shims) and never attempts to cross them.

## Test strategy

Levels: **integration (primary) + a small unit/fixture-integrity check.** NOT parity (there is no Node-vs-rifty behavioral output to diff here — this feature produces a VFS state, not runtime behavior; parity is reserved for features 03/04/05/08 where Node semantics matter).

1. **Fixture-integrity unit test:** assert the generated `facade.package.json` contains every KEEP-list name and NONE of the PRUNE-list names; assert no `workspace:`/`catalog:` string survives in the dependency ranges (i.e. all pins are concrete semver). This catches drift if the vendor script is re-run against a moved SHA.
2. **Integration test** (opt-in, sandbox-disabled like `vite-live-run.opt-in.test.ts` since live npm is needed): run `overlayOpencodeSources` + `install(opencodeFacadeDeps())` against a memory VFS and assert (a) install completes without `ENATIVEUNSUPPORTED`, (b) `/workspace/node_modules/effect/package.json` and `/workspace/node_modules/opencode/src/server/server.ts` exist in the VFS, (c) `opencode/package.json` `imports` map (`#db`/`#pty`) is present verbatim. Stop at "files are resolvable on disk" — actually importing `server.ts` (which trips `#db`→`node:sqlite`) is feature 02/03's assertion, explicitly out of scope here.
3. The vendor script gets a guarded run-once check (records SHA) rather than a test that hits GitHub on every CI run.

## Implementation plan (test-first)

1. **T1 — KEEP/PRUNE/SHIM dependency lists + classifier (`kind: unit`)**
   - **Description:** Define the KEEP / PRUNE / SHIM-not-install dependency lists from the feasibility de-risk as committed data, plus a small predicate module that classifies a dep name. This is the source of truth both the vendor script (T3) and the fixture-integrity test (T2) consume, so it must exist first and be testable in isolation (pure data + pure functions, no network). Lives under `scripts/` because it is dev/build-time only and never bundled into any package's public API.
   - **FAILING test first:** `tests/integration/opencode-facade-lists.test.ts :: it('KEEP and PRUNE lists are disjoint and cover the de-risk names')` — assert KEEP includes `'effect'`,`'@effect/platform-node'`,`'ai'`,`'zod'`,`'ulid'`,`'drizzle-orm'`,`'@modelcontextprotocol/sdk'`; assert PRUNE includes `'@parcel/watcher'`,`'bun-pty'`,`'solid-js'`,`'@opentui/core'`; assert `KEEP ∩ PRUNE === ∅`; assert `classifyDep('@parcel/watcher')==='prune'` and `classifyDep('effect')==='keep'` and `classifyDep('bun:sqlite')==='shim'`. Fails because `scripts/opencode-facade/dep-lists.ts` does not exist.
   - **Files:** `scripts/opencode-facade/dep-lists.ts`, `tests/integration/opencode-facade-lists.test.ts`

2. **T2 — Pure catalog/workspace flattener (`kind: unit`)**
   - **Description:** Pure catalog/workspace flattener: given `packages/opencode/package.json` content + the workspace-root catalog map, emit a plain npm-style `package.json` (the facade manifest) — resolve every `'catalog:'`/`'catalog:<name>'` range to the concrete version from the catalog, DROP every `'workspace:'` dep, keep only KEEP-list names, omit PRUNE/SHIM names. This is the make-or-break correctness unit of the whole feature and must be tested against fixture inputs (no network). No live opencode source required — feed it hand-built minimal `package.json` + catalog objects.
   - **FAILING test first:** `tests/integration/opencode-facade-manifest.test.ts :: it('resolves catalog: to concrete versions, drops workspace:, prunes natives')` — given deps `{effect:'catalog:', '@parcel/watcher':'catalog:', '@opencode-ai/sdk':'workspace:*', 'bun-pty':'1.0.0'}` and catalog `{effect:'4.0.0-beta.66', '@parcel/watcher':'2.0.0'}`, assert `output.dependencies === {effect:'4.0.0-beta.66'}`; assert no value contains `'catalog:'` or `'workspace:'`; assert `'@opencode-ai/sdk'`,`'@parcel/watcher'`,`'bun-pty'` all absent. Fails because `buildFacadeManifest` is not implemented.
   - **Files:** `scripts/opencode-facade/build-facade-manifest.ts`, `tests/integration/opencode-facade-manifest.test.ts`

3. **T3 — `vendorOpencode(opts)` one-shot pin/fetch/flatten script (`kind: harness`)**
   - **Description:** `vendorOpencode(opts)`: the one-shot, guarded pin/fetch/flatten script. Fetches `packages/opencode/src` + `package.json` + needed `@opencode-ai/*` sibling src at a pinned SHA, writes them under `outDir`, calls `buildFacadeManifest` (T2) and writes `facade.package.json`, records the SHA. This is dev-only and network-touching; it is NOT run in CI. Test it with the network path injected (a fake fetcher returning canned file blobs) so the test is deterministic and offline — only the wiring (SHA recorded, facade emitted, src files written) is asserted, not GitHub itself.
   - **FAILING test first:** `tests/integration/opencode-vendor.test.ts :: it('vendors src + emits facade.package.json + records SHA via injected fetcher')` — call `vendorOpencode({sha:'abc123', outDir:tmp, fetchTree:fakeFetcher})` where `fakeFetcher` returns a canned `{'packages/opencode/package.json':..., 'packages/opencode/src/server/server.ts':...}`; assert `result.sha==='abc123'`, `result.vendoredFiles>=2`, a `facade.package.json` exists at `outDir` with concrete pins, and `outDir/src/server/server.ts` was written verbatim. Fails because `vendorOpencode` is not implemented.
   - **Files:** `scripts/opencode-facade/vendor-opencode.ts`, `tests/integration/opencode-vendor.test.ts`

4. **T4 — `overlayOpencodeSources` + `opencodeFacadeDeps` VFS helper (`kind: integration`)**
   - **Description:** `overlayOpencodeSources(fsSync, root)` + `opencodeFacadeDeps()` helper: writes the vendored src tree + every `package.json` (opencode's own, with its `'imports'` `#db`/`#pty` map and `'exports'` `./*` verbatim, plus each `@opencode-ai/*` sibling) into a memory VFS at `node_modules` locations, mirroring the `real-vite-smoke.ts:97-104` overlay loop (`mkdirSync(dirname)`+`writeFileSync`). `opencodeFacadeDeps` reads `facade.package.json`. This is the seam feature 06's harness consumes. Tested against a small committed mini-fixture so it is offline and deterministic; full vendored tree comes from T3 at refresh time.
   - **FAILING test first:** `tests/integration/opencode-overlay.test.ts :: it('overlays src + package.json imports map into a memory VFS at resolvable paths')` — `createMemoryFs()`; `overlayOpencodeSources(fsSync,'/workspace')`; assert `fsSync.existsSync('/workspace/node_modules/opencode/src/server/server.ts')`; assert `JSON.parse(read('/workspace/node_modules/opencode/package.json')).imports['#db']` is present verbatim; assert `opencodeFacadeDeps()` has no `'catalog:'`/`'workspace:'` substrings. Fails because `overlay.ts` does not exist.
   - **Files:** `tests/integration/fixtures/opencode/overlay.ts`, `tests/integration/opencode-overlay.test.ts`

5. **T5 — Fixture-integrity guard over committed `facade.package.json` (`kind: conformance`)**
   - **Description:** Fixture-integrity guard over the COMMITTED generated `facade.package.json` (the artifact T3 produces and we check in). Distinct from T1 (which tests the list module) and T2 (which tests the flattener on synthetic input): this reads the real committed file and asserts it is in-sync — every KEEP name present, no PRUNE name present, no `'catalog:'`/`'workspace:'` string survives, every dependency range is concrete semver. This is the drift detector that fails loudly if someone re-runs the vendor script against a moved SHA and the facade regresses.
   - **FAILING test first:** `tests/integration/opencode-facade-integrity.test.ts :: it('committed facade.package.json is in-sync with KEEP/PRUNE and fully concrete')` — read `tests/integration/fixtures/opencode/facade.package.json`; for each name in KEEP assert it is a dependency key; for each name in PRUNE assert it is absent; assert every range matches `/^[\d^~]/` (no `'catalog:'`/`'workspace:'`/`'*'`). Fails until the committed `facade.package.json` exists and is correct.
   - **Files:** `tests/integration/opencode-facade-integrity.test.ts`, `tests/integration/fixtures/opencode/facade.package.json`

6. **T6 — End-to-end opt-in fixture-load harness (`kind: e2e`)**
   - **Description:** End-to-end opt-in fixture-load harness, forked from `real-vite-smoke.ts` + `vite-live-run.opt-in.test.ts`. Standalone tsx script: `createMemoryFs`+`setSyncMirror`, `overlayOpencodeSources(fsSync,'/workspace')`, write a root `package.json` whose deps = `opencodeFacadeDeps()`, `install('opencode-facade','0.0.0', deps, {vfs, cwd:ROOT, registry})` against the LIVE registry, then assert files-on-disk only (NOT importing `server.ts` — that trips `#db` and is feature 02/03). Skipped by default (needs network); driven by an opt-in vitest that spawns it, exactly like vite. This proves the install completes without `ENATIVEUNSUPPORTED` (the prune list is tuned to never reach `installer.ts:502` `assertNativeSupported`) and the KEEP graph lands in the VFS.
   - **FAILING test first:** `tests/integration/opencode-fixture-load.opt-in.test.ts :: it('overlays + installs the facade KEEP set without ENATIVEUNSUPPORTED')` (`describe.skipIf(!RIFTY_LIVE_REGISTRY)`) — spawn the tsx harness; assert exit 0 and stdout contains `'OPENCODE_FIXTURE_LOAD_OK'`; the harness prints that only after asserting `/workspace/node_modules/effect/package.json` AND `/workspace/node_modules/opencode/src/server/server.ts` exist AND `opencode/package.json` `imports['#db']` present. Fails because neither the harness nor the opt-in driver exist.
   - **Files:** `tests/integration/fixtures/opencode-fixture-load-smoke.ts`, `tests/integration/opencode-fixture-load.opt-in.test.ts`

### Scaffolding sketch

```ts
// scripts/opencode-facade/dep-lists.ts
export const KEEP: readonly string[] = ['effect','@effect/platform-node','ai','@ai-sdk/provider','@ai-sdk/anthropic','@ai-sdk/openai','@ai-sdk/google','zod','ulid','remeda','decimal.js','partial-json','immer','gray-matter','jsonc-parser','semver','minimatch','ignore','glob','mime-types','htmlparser2','turndown','fuzzysort','@standard-schema/spec','drizzle-orm','@modelcontextprotocol/sdk'];
export const PRUNE: readonly string[] = ['@opentui/core','solid-js','bun-pty','@lydell/node-pty','@parcel/watcher','chokidar','which','cross-spawn','open','clipboardy','ws','bonjour-service','@opentelemetry/api'/* …de-risk PRUNE list verbatim */];
export const SHIM_NOT_INSTALL: readonly string[] = ['bun:sqlite','node:sqlite','drizzle-orm/bun-sqlite','drizzle-orm/node-sqlite'];
export function classifyDep(name: string): 'keep' | 'prune' | 'shim';

// scripts/opencode-facade/build-facade-manifest.ts
interface PackageJsonLike { name?: string; version?: string; type?: string; dependencies?: Record<string,string>; imports?: Record<string,unknown>; exports?: Record<string,unknown>; }
export function buildFacadeManifest(opencodePkg: PackageJsonLike, catalog: Record<string,string>): PackageJsonLike;
// resolves 'catalog:'/'catalog:<n>' via catalog map (throws if a KEEP dep has an unresolvable catalog ref — no silent placeholder),
// drops 'workspace:' deps, filters to classifyDep(name)==='keep'.

// scripts/opencode-facade/vendor-opencode.ts
type TreeFetcher = (sha: string) => Promise<Record<string,string>>; // path -> file content
export interface VendorResult { sha: string; vendoredFiles: number; facadeManifest: PackageJsonLike }
export function vendorOpencode(opts: { sha: string; outDir: string; fetchTree?: TreeFetcher }): Promise<VendorResult>;
// default fetchTree shells to git/curl (dev-only); records sha into outDir/VENDOR_SHA.

// tests/integration/fixtures/opencode/overlay.ts
import type { FsSync } from '../../../../packages/vfs/src/internal/index.ts';
export const OPENCODE_PKG_DIR = '/workspace/node_modules/opencode';
export const OPENCODE_SERVER_ENTRY = '/workspace/node_modules/opencode/src/server/server.ts';
export function overlayOpencodeSources(fsSync: FsSync, root: string): void; // mkdirSync(dirname)+writeFileSync loop, mirrors real-vite-smoke.ts:97-104
export function opencodeFacadeDeps(): Record<string,string>; // JSON.parse(facade.package.json).dependencies

// harness (tests/integration/fixtures/opencode-fixture-load-smoke.ts): fork of real-vite-smoke.ts —
// install('opencode-facade','0.0.0', opencodeFacadeDeps(), {vfs,cwd:ROOT,registry}); assert files exist; print OPENCODE_FIXTURE_LOAD_OK.
```

### Risks

- The `@ai-sdk` provider sublist (anthropic/openai/google) is a judgement call from the de-risk's "etc"; if the vendored source statically imports another provider (e.g. `@ai-sdk/amazon-bedrock`) the T6 install will surface a concrete `MODULE_NOT_FOUND` for follow-up rather than crash — accept and log to `OPEN_QUESTIONS`, do not guess more providers.
- `catalog:` resolution assumes the workspace-root `package.json` carries a flat `catalog` map; `opencode@dev` may use `catalogs` (named groups) — if so `buildFacadeManifest` must read `catalog:<group>` refs against `catalogs[group]`. Verify the actual root manifest shape at vendor time before T2's flattener locks its input contract.
- A KEEP-list package could ship a native (cpu) artifact transitively (e.g. an esbuild-style optional) and trip `installer.ts:502` `assertNativeSupported` during T6's live install. ADR-0051 catches OPTIONAL natives (skip+warn) but ABORTS on required natives — if a required native sneaks onto the KEEP graph the install fails and the prune list must be widened; this is data-only and reversible but must be observed before declaring T6 green.
- drizzle-orm CORE is KEEP but `drizzle-orm/bun-sqlite` + `/node-sqlite` subpaths are SHIM-not-install; installing drizzle-orm itself is fine, but if the vendored src statically imports the bun-sqlite subpath at module top-level, feature 02's loader (not this feature) will trip — must confirm the import is lazy/conditional so T6 stays at files-on-disk.
- Vendored fixture staleness: the pinned SHA captures `opencode@dev` which moves; mitigated by `VENDOR_SHA` record + T5 drift guard, but a refresh that adds a new top-level dep silently widens the real graph — T5 only checks KEEP/PRUNE membership, so a brand-new unknown dep would pass T5 and only surface at T6 install time.
- Sibling `@opencode-ai/*` workspace packages: the design overlays them by path, but the exact set needed on the `Server.listen` graph is not enumerated here (it is whatever `server.ts` transitively imports). If the de-risk under-counted siblings, T4's mini-fixture passes but T6's real install/overlay reveals a missing sibling as `MODULE_NOT_FOUND` for feature 02.

### Estimate

3-4 evening-units (T1+T2 pure-unit ~1; T3 vendor wiring with injected fetcher ~1; T4 overlay helper ~0.5; T5 integrity guard ~0.25; T6 opt-in harness fork + first real live install + prune-list tuning ~1-1.5, dominated by iterating the KEEP/PRUNE list against the actual install).

### Ratification gate

**NONE.** All four design decisions (Q-2026-05-30-101..104) are classified REVERSIBLE with sound justifications: work is confined to `scripts/**` and `tests/integration/fixtures/**`, reuses `install()`/`createMemoryFs`/`fsSync` unchanged (no public-API edit, fails IRREVERSIBLE trigger 1), introduces NO new runtime dependency that is bundled (vendor script may shell to dev-only git/curl, fails trigger 2), contradicts no ADR (ADR-0051 native gate still applies, fails trigger 3), and reverts by deleting the fixture dir + scripts (fails trigger 4).

> **WARNING — boundary that MUST hold:** this plan must NOT add `sql.js` / `wa-sqlite` or any Effect adapter shim — those are **IRREVERSIBLE** (new external dep, rule 2) and belong to features 03/04, which carry their own ratification gate. If implementation finds the facade cannot install without pulling such a dep, **STOP and surface an ADR draft** rather than adding it here.
