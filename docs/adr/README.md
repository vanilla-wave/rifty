# Architecture Decision Records

ADRs are immutable while active. A superseded ADR is REMOVED (git keeps history); its load-bearing context is grafted into the successor. New decisions get new ADRs via `pnpm adr:new <area> "Title"`.

## Index

### vfs

| # | Title |
|---|---|
| 0014 | `getFsVfs()` and `syncMirror()` share one backing tree |
| 0020 | `Vfs.openReadable()` for true `createReadStream` |
| 0029 | `utimes` on the `FsSync` interface |
| 0037 | Unified sync VFS contract |
| 0041 | `FsSync.readdirSync` returns `VfsDirent[]` and `Vfs.utimes` symmetry |
| 0072 | OPFS sync content cache + async write-through |

### kernel

| # | Title |
|---|---|
| 0011 | Sync IPC via SharedArrayBuffer + Atomics; Worker-as-process model |
| 0012 | `@riftydev/io` owns shared primitives; `@riftydev/kernel` owns processes |
| 0019 | `cwd` lives in `kernel.ProcessRecord` |
| 0039 | Lift Node-API knowledge from kernel to runtime-js |
| 0045 | Worker-process IPC — fork-mode `send` / `'message'` / `disconnect` over a parent↔child MessagePort |

### runtime-js

| # | Title |
|---|---|
| 0004 | Module loader — hybrid `es-module-lexer` + own resolver |
| 0009 | AST-based ESM transform |
| 0018 | Expanded `@riftydev/runtime-js` public surface via subpath exports |
| 0026 | `process.platform` / `process.arch` report honest values |
| 0030 | Buffer extends Uint8Array (real subclass, Symbol.species) |
| 0034 | `@riftydev/io` streams — Node-contract restoration |
| 0035 | Builtin registry in `@riftydev/io` |
| 0050 | No-symlink `fs.realpath`/`fs.lstat` semantics |
| 0052 | TS-on-import transform hook on `ModuleLoaderOptions` |
| 0053 | `.ts`/`.tsx` as first-class resolvable + ESM module extensions |
| 0066 | tsconfig-style path aliases via an explicit `paths` resolver option |
| 0067 | text-asset imports (`.txt` / `.sql` / `.md` / `.prompt` → file contents) |
| 0068 | `with { type: "file" }` file-loader import attribute (asset → path) |
| 0069 | `Readable.setEncoding(encoding)` — emit decoded strings |

### runtime-wasi

| # | Title |
|---|---|
| 0038 | WasiProcessHandle — kernel adapter for WASI guests |
| 0047 | Revert to esbuild (`@esbuild/wasi-preview1`) as the M8/M10 WASI forcing consumer |
| 0049 | WASI `cwd` option + `AT_FDCWD` and directory-open semantics |

### net

| # | Title |
|---|---|
| 0010 | `node:https` registered as a loud-throw stub |
| 0017 | `@riftydev/net` scope statement and streaming rewrite deferral |
| 0054 | Effect `@effect/platform-node` consumes rifty `node:http` AS-IS via additive shape-widening |
| 0065 | `node:sqlite` `DatabaseSync` WASM shim — sql.js, in-memory-first (P2 boot prerequisite) |

### service-worker

| # | Title |
|---|---|
| 0002 | Cross-origin isolation is mandatory |
| 0016 | Service Worker source-of-truth lives in `@riftydev/service-worker` |
| 0046 | `PreviewOwnerBinding` — one seam for window and worker preview owners |

### npm-client

| # | Title |
|---|---|
| 0005 | Dev proxy for npm registry via Vite |
| 0006 | Shadow registry — layered strategy with ecosystem leverage |
| 0015 | Shadow-registry consolidation under `tools/shadow-registry/` |
| 0021 | Integration tests must use real `npm install` |
| 0023 | Lockfile reuse on subsequent `install()` |
| 0027 | Per-file shim overlays live in the consuming adapter |
| 0028 | Vercel Edge Function proxies npm registry in production |
| 0042 | M11 nested install — first-wins flat + nest-on-conflict |
| 0051 | Native-dependency install policy — loud `ENATIVEUNSUPPORTED`, optional natives skipped |

### playground

| # | Title |
|---|---|
| 0003 | Playground UI on SolidJS, isolated from core |
| 0007 | Chrome-first with cross-browser infrastructure from M0 |
| 0073 | Playground UX overhaul — preset gallery, design system, production worker bundling, honest preview status |
| 0075 | Playground VSCode-style shell — bottom console panel, resizable/collapsible splitters, VFS file explorer, multi-model editor tabs |
| 0076 | Cross-realm reverse VFS snapshot — the file explorer reflects the real-vite worker project |
| 0077 | Real Vite preview renders — worker lifetime, log surfacing, and SW frame routing |
| 0078 | Generic ProjectSpec/Template runtime for the playground (Vite as the default template) |
| 0079 | Single generic project/template switcher; retire the header mode toggles |
| 0080 | Lazy `node_modules` remote-read protocol + async explorer path |

### toolchain-build

| # | Title |
|---|---|
| 0001 | Monorepo on pnpm workspaces |
| 0043 | Vite-in-Worker realm and cross-realm preview bridge |
| 0070 | npm publish — tsup build + dual (dev-src / publish-dist) exports |
| 0071 | Umbrella `@riftydev/sdk` package — one-install front door |

### protocol

| # | Title |
|---|---|
| 0031 | Every SW↔main wire frame carries `version`, receivers validate at decode |
| 0032 | SyncRpc protocol-version field in the SAB header |
| 0036 | Preview-protocol addressing in `@riftydev/io` |
| 0040 | SW frame and routing versions split |
| 0048 | Streaming cross-realm preview wire-frame |

### process-meta

| # | Title |
|---|---|
| 0022 | Parity and E2E coverage gates per milestone |
| 0033 | File budget removed; structure over size |
| 0063 | Record-and-continue decisions; decision subagent for reconsiderations |
| 0064 | Inflections are not stops — empirical findings and verified-need commitments don't pause for the human |
| 0094 | Superseded ADRs are removed, not retained (amends the immutability "keep the old" rule for retention only) |

### opencode

| # | Title |
|---|---|
| 0055 | opencode event stream rides SSE-over-streaming-HTTP; no `ws` shim (page-direct deployment) |

## Superseded (removed)

ADRs below were removed; load-bearing context grafted into the successor. See git history.

| removed | superseded by | note |
|---|---|---|
| 0008 | 0063 / 0064 | record-and-continue |
| 0013 | 0072 | OPFS hot path; context grafted |
| 0024 | 0033 | file budget; WASI-coverage note grafted |
| 0025 | 0043 | dev-server realm; page-realm globals-guard grafted |
| 0044 | 0047 | esbuild WASI |

## Appendix A — Q→ADR provenance

Promoted `OPEN_QUESTIONS` ids → ADRs.

| Q | ADR |
|---|---|
| Q-2026-05-23-001 | 0009 |
| Q-2026-05-23-002 | 0025 (removed) |
| Q-2026-05-23-003 | 0026 |
| Q-2026-05-23-004 | 0027 |
| Q-2026-05-23-005 | 0018 |
| Q-2026-05-23-006 | Rejected / 0010 |
| Q-2026-05-24-007 | 0028 (reopened) |
| Q-2026-05-25-touch-utimes | 0029 |
| Q-2026-05-27-002 | 0046 |
| Q-2026-05-27-003 | 0049 |
| Q-2026-05-29-001 | 0048 |
| Q-2026-05-29-002 | 0050 |
| Q-2026-05-30-001 | 0051 |

## Appendix B — D→ADR map

| D | ADR |
|---|---|
| D-001 | 0002 |
| D-002 | 0003 |
| D-003 | 0004 |
| D-004 | 0005 |
| D-005 | 0006 |
| D-006 | 0007 |
| D-007 | 0008 (removed → 0063) |
| D-008 | 0063 |
| D-009 | 0064 |

## Numbering

The retention-policy ADR is **0094** (see process-meta). Numbers **0081–0093 are RESERVED** as provisional labels by the JS-runtime perf plan (`docs/backlog/perf/adr-008x-*.md`); each becomes a real ADR file only when that wave's work is authored. `pnpm adr:new` computes the next free number, so it allocates from **0095+** and leaves the reserved block untouched.

## Historical references

Deleted root docs are still cited inside older ADRs; their content moved. Do not rewrite those in-ADR references — this note resolves them.

- `PROJECT_PLAN.md` → `CLAUDE.md` (vision/architecture) + `docs/ROADMAP.md` (milestones)
- `OPEN_QUESTIONS.md` → `docs/backlog/<area>/`
- `REVIEW_ACTIONS.md` → removed (closed review ledger; git history)
