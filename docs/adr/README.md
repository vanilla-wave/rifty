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
| 0090 | VFS sync `copyFileSync`/`cpSync`/`renameSync` primitives for shell `cp`/`mv` |

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
| 0136 | Transformed-module stack remapping via scoped prepareStackTrace |

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
| 0097 | Preview frame port context routes root-relative requests |
| 0123 | Port-aware preview owner routing |
| 0125 | Preview owner binding — async resolution, ready-window preference, clientId sentinels |

### npm-client

| # | Title |
|---|---|
| 0005 | Dev proxy for npm registry via Vite |
| 0006 | Shadow registry — layered strategy with ecosystem leverage |
| 0015 | Shadow-registry consolidation under `tools/shadow-registry/` |
| 0021 | Integration tests must use real `npm install` |
| 0023 | Lockfile reuse on subsequent `install()` |
| 0027 | Per-file shim overlays live in the consuming adapter |
| 0042 | M11 nested install — first-wins flat + nest-on-conflict |
| 0051 | Native-dependency install policy — loud `ENATIVEUNSUPPORTED`, optional natives skipped |
| 0133 | Netlify npm-registry proxy v2 — netlify-build deploys, pre-SPA function redirects, runtime site env, buffered bodies, CI deploy smoke |

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
| 0095 | Dev-mode HMR routes through the cross-realm bridge (pluggable dev-server transport) |
| 0124 | Soft Panels visual redesign adopts the Gravity UI handoff |
| 0126 | Preview reloads are HMR-client-driven; snapshot-driven iframe reload removed |
| 0130 | Node-server project template runtime (Express + node:sqlite demo) |

### toolchain-build

| # | Title |
|---|---|
| 0001 | Monorepo on pnpm workspaces |
| 0043 | Vite-in-Worker realm and cross-realm preview bridge |
| 0070 | npm publish — tsup build + dual (dev-src / publish-dist) exports |
| 0071 | Umbrella `@riftydev/sdk` package — one-install front door |
| 0131 | Public sandbox filesystem API for AI agents |
| 0132 | TS ESM parity uses full-transform Node reference |

### protocol

| # | Title |
|---|---|
| 0031 | Every SW↔main wire frame carries `version`, receivers validate at decode |
| 0032 | SyncRpc protocol-version field in the SAB header |
| 0036 | Preview-protocol addressing in `@riftydev/io` |
| 0040 | SW frame and routing versions split |
| 0048 | Streaming cross-realm preview wire-frame |

### perf

| # | Title |
|---|---|
| 0082 | Export `bytesToString` from `@riftydev/io` — drop the text-read full-buffer copy |
| 0083 | `FsSync.statSyncOrNull` — non-throwing stat collapses resolver double-probes |
| 0084 | SAB ring + SyncRpc v2 wire — `waitAsync` responder, zero-copy view, configurable capacity, binary frame |
| 0085 | `setImmediate` Map rep + check-phase drain-order contract |
| 0086 | Optional `dispatchStruct` on `CrossRealmPortHandler` |
| 0087 | Honest execSync-over-SAB COI-Worker e2e — public handler seams + SAB JSON-frame decode fix |

### shell

| # | Title |
|---|---|
| 0088 | Coreutils command-surface strategy — pure-JS builtins over VFS; busybox rejected, uutils/picomatch ADR-gated |
| 0089 | `CommandContext` gains optional stdin, isTTY/cols/rows, AbortSignal cancellation |
| 0091 | Rich token type (quote provenance) + single-segment glob expansion |
| 0093 | Shell-command parity harness — node:fs reuse + frozen GNU fixtures, no live host-spawn oracle |
| 0121 | Background jobs |
| 0137 | Shell PATH-style node_modules/.bin resolution + injected BinExecutor seam |

### terminal

| # | Title |
|---|---|
| 0094 | Terminal line-editor becomes cursor-aware — mid-line insert/delete, Home/End/Delete, Ctrl+A/Ctrl+E |
| 0096 | Terminal line-editor model |
| 0098 | Terminal options polish API |
| 0100 | Command block metadata substrate |
| 0104 | Host assistance seams |
| 0105 | xterm addons and escape policy |
| 0116 | Persisted terminal session state |
| 0120 | AI command suggestions |
| 0122 | Raw stdin and mouse reporting |

## Superseded (removed)

ADRs below were removed; load-bearing context grafted into the successor. See git history.

| removed | superseded by | note |
|---|---|---|
| 0013 | 0072 | OPFS hot path; context grafted |
| 0025 | 0043 | dev-server realm; page-realm globals-guard grafted |
| 0028 | 0133 | prod npm-registry proxy; deploy/routing/env contract reshaped, context grafted |
| 0044 | 0047 | esbuild WASI |
| 0046 | 0125 | owner-binding seam; microtask invariant dropped, context grafted |
| 0055 | n/a | retired opencode facade ADR; integration cancelled |
| 0074 | 0077 | SW preview-nav routing; ported into ADR-0077 |
| 0092 | n/a | retired opencode facade ADR; integration cancelled |

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
| Q-2026-05-24-007 | 0028 (removed) |
| Q-2026-05-25-touch-utimes | 0029 |
| Q-2026-05-27-002 | 0046 (removed) |
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

D-007..D-009 (stop-on-irreversible → record-and-continue, inflections) were process decisions; process is no longer recorded in ADRs — see `AGENTS.md` + `docs/process/decision-workflow.md`.

## Numbering

No reserved numbers. The JS-runtime perf plan's provisional **0081–0093** band was materialised in the M11/M12 merge — **0082–0093** as ADRs, **0081** retired into `docs/process/decision-workflow.md` (reversibility rule 4, record-decisions-not-diffs). `pnpm adr:new <area> "Title"` auto-allocates from a machine-local counter seeded from repo max; each successful allocation increments that counter before the ADR is written, so parallel worktrees on one machine get distinct numbers. `--number NNNN` authors a specific free number. `tools/adr/new.mjs` and `tools/refs/check.mjs` keep an (now empty) `RESERVED` set in sync with this note.

## Historical references

Moved/removed docs are still cited inside older (immutable) ADRs; their content moved or closed. **Do not rewrite those in-ADR references — this note resolves them.** `tools/refs/check.mjs` enforces this table (every cited `docs/…` path must resolve, redirect, or be tombstoned here), so it cannot silently rot.

Moved (redirect to the live path):

- `PROJECT_PLAN.md` → `docs/ARCHITECTURE.md` (vision/architecture) + `docs/ROADMAP.md` (milestones)
- `OPEN_QUESTIONS.md` → `docs/backlog/<area>/`
- `docs/compat/` → `docs/public/compat/`
- `docs/perf/` → `docs/backlog/perf/reference/`
- `docs/backlog/tests/` → `docs/backlog/toolchain-build/reference/`
- `docs/PUBLISHING.md` → `docs/public/publishing.md`
- `docs/hosting-netlify.md` → `docs/public/hosting-netlify.md`

Removed, no successor (resolve to git history):

- `REVIEW_ACTIONS.md`, `TASKS.md` — closed review/acceptance ledgers
- `docs/follow-ups-2026-05-27.md`, `docs/follow-ups-architecture-review-2026-05-27.md`, `docs/large-targets-readiness-2026-05-27.md`, `docs/review/2026-05-26-architecture-review.md` — closed review/follow-up ledgers
- `docs/processes/ecosystem-sweep.md`, `docs/backlog-distribution-and-ide.md` — folded into `docs/backlog/<area>/`
- `docs/opencode/`, `docs/opencode-rifty-feasibility-2026-05-30.md`, `docs/opencode/HANDOFF.md` — retired server-facade exploration, not retained
- `docs/compat/{m10-tooling,sqlite,opencode-tool-ceiling,browsers}.md` — compat pages dropped in the `docs/public` split (not regenerated)

Retired ADR numbers (process moved to `AGENTS.md` / `docs/process/decision-workflow.md`, no longer recorded as ADRs): **0008, 0022, 0024, 0033, 0063, 0064, 0081**. Older ADRs may still cite these — they resolve there, not to a file. Older docs may also cite `CLAUDE.md` — it is a symlink to `AGENTS.md`. `tools/refs/check.mjs` treats them as retired so the citations don't dangle. (0081 = reversibility rule 4 "record decisions, not diffs"; its rule text is grafted into `docs/process/decision-workflow.md`.)
