# Architecture Decision Records

ADRs are immutable after merge. New decisions get new ADRs; supersedence is explicit (the new ADR cites and overrides the old).

| # | Title | Decision in PROJECT_PLAN.md |
|---|---|---|
| 0001 | Monorepo on pnpm workspaces | — |
| 0002 | Cross-origin isolation is mandatory | D-001 |
| 0003 | Playground UI on SolidJS, isolated from core | D-002 |
| 0004 | Module loader — hybrid `es-module-lexer` + own resolver | D-003 |
| 0005 | Dev proxy for npm registry via Vite | D-004 |
| 0006 | Shadow registry — layered strategy | D-005 |
| 0007 | Chrome-first with cross-browser infrastructure from M0 | D-006 |
| 0008 | Reversible decisions — agents don't block on every dilemma (stop-on-irreversible action superseded by ADR-0063) | D-007 |
| 0009 | AST-based ESM transform (supersedes ADR 0004 §"ESM loader") | — |
| 0010 | `node:https` registered as a loud-throw stub | — |
| 0011 | Sync IPC via SharedArrayBuffer + Atomics; Worker-as-process model | — |
| 0012 | `@rifty/io` owns shared primitives; `@rifty/kernel` owns processes | — |
| 0013 | OPFS as the primary VFS in browser deploys | — |
| 0014 | `getFsVfs()` and `syncMirror()` share one backing tree | — |
| 0015 | Shadow-registry consolidation under `tools/shadow-registry/` | — |
| 0016 | Service Worker source-of-truth lives in `@rifty/service-worker` | — |
| 0017 | `@rifty/net` scope statement and streaming rewrite deferral | — |
| 0018 | Expanded `@rifty/runtime-js` public surface via subpath exports | — |
| 0019 | `cwd` lives in `kernel.ProcessRecord` | — |
| 0020 | `Vfs.openReadable()` for true `createReadStream` | — |
| 0021 | Integration tests must use real `npm install` | — |
| 0022 | Parity and E2E coverage gates per milestone | — |
| 0023 | Lockfile reuse on subsequent `install()` | — |
| 0024 | File-size budget | — |
| 0025 | Toolchain dev servers run on the playground main thread (partially superseded by ADR-0043 for the Real Vite path) | — |
| 0026 | `process.platform` / `process.arch` report honest values | — |
| 0027 | Per-file shim overlays live in the consuming adapter | — |
| 0028 | Vercel Edge Function proxies npm registry in production | closes Q4' |
| 0029 | `FsSync.utimes` (closes Q-2026-05-25-touch-utimes) | — |
| 0030 | `Buffer extends Uint8Array` (replaces symbol-bag brand) | — |
| 0031 | Every SW↔main wire frame carries `version`; receivers validate at decode (extends ADR-0016; split into frame+routing by ADR-0040) | — |
| 0032 | SyncRpc protocol-version field in the SAB header | — |
| 0033 | File budget removed; structure over size (supersedes ADR-0024) | — |
| 0034 | `@rifty/io` streams — Node-contract restoration | — |
| 0035 | Builtin registry in `@rifty/io` | — |
| 0036 | Preview-protocol addressing in `@rifty/io` | — |
| 0037 | Unified sync VFS contract | — |
| 0038 | `WasiProcessHandle` — kernel adapter for WASI guests | — |
| 0039 | Lift Node-API knowledge from kernel to runtime-js | — |
| 0040 | SW frame and routing versions split (splits ADR-0031 into two version axes) | — |
| 0041 | `FsSync.readdirSync` returns `VfsDirent[]` and `Vfs.utimes` symmetry | — |
| 0042 | M11 nested install — first-wins flat + nest-on-conflict | — |
| 0043 | Vite-in-Worker realm and cross-realm preview bridge (partially supersedes ADR-0025 for the Real Vite path) | — |
| 0044 | esbuild ships gojs ABI — substitute swc as the M8/M10 forcing consumer; defer the Go-runtime bridge (D1/D2 superseded by ADR-0047) | — |
| 0045 | Worker-process IPC — fork-mode `send`/`'message'`/`disconnect` over a parent↔child MessagePort (extends ADR-0011 phase 2) | — |
| 0046 | `PreviewOwnerBinding` — one seam for window and worker preview owners (promotes Q-2026-05-27-002) | — |
| 0047 | Revert to esbuild (`@esbuild/wasi-preview1`) as the M8/M10 WASI forcing consumer (supersedes ADR-0044 D1/D2; keeps D3/D4) | — |
| 0048 | Streaming cross-realm preview wire-frame — net-local `PREVIEW_PORT_FRAME_VERSION`, additive `reply-stream-*` frames, per-request mode selection (promotes Q-2026-05-29-001) | — |
| 0049 | WASI `cwd` option + `AT_FDCWD` and directory-open semantics (promotes Q-2026-05-27-003) | — |
| 0050 | No-symlink `fs.realpath`/`fs.lstat` semantics — `lstat≡stat`, `realpath≡normalise-if-exists` for the symlink-free VFS (promotes Q-2026-05-29-002) | — |
| 0051 | Native-dependency install policy — `cpu`-keyed `ENATIVEUNSUPPORTED` loud-throw, optional natives skipped (promotes Q-2026-05-30-001) | — |
| 0052 | TS-on-import transform hook on `ModuleLoaderOptions` — injected `transformSource` (`{source,id,loader,workspace}`→`Promise<string>`) + `workspace?`, async, ESM-only, extension-keyed (feature-02 T2) | — |
| 0053 | `.ts`/`.tsx` as first-class resolvable + ESM module extensions — after the `.js` family, `type:module` classification (feature-02 T1) | — |
| 0054 | Effect `@effect/platform-node` consumes rifty `node:http` AS-IS via additive shape-widening — no dedicated cross-package Effect HTTP adapter; pipe-sink DEFERRED (ratifies decisions.md draft ADR-0057; feature-05) | — |
| 0055 | opencode event stream rides SSE-over-streaming-HTTP — no `ws` shim, page-direct deployment only; Worker v3 frame bump DEFERRED (ratifies decisions.md draft ADR-0059; feature-07) | — |
| 0063 | Record-and-continue decisions; explicit decision subagent for reconsiderations (supersedes ADR-0008/D-007 stop action) | D-008 |
| 0064 | Inflections are not stops — empirical findings / verified-need dependency commitments / stale-assumption corrections don't pause for the human (extends ADR-0063) | D-009 |
| 0065 | `node:sqlite` `DatabaseSync` WASM shim — sql.js, in-memory-first (P2 boot prerequisite); OPFS persistence deferred (supersedes decisions.md DRAFTS ADR-0055/0056) | — |
| 0066 | tsconfig-style path aliases via an explicit `paths` resolver option | — |
| 0067 | text-asset imports (`.txt` / `.sql` / `.md` / `.prompt` → file contents) | — |
| 0068 | `with { type: "file" }` file-loader import attribute (asset → path) | — |
| 0069 | `Readable.setEncoding(encoding)` — emit decoded strings | — |
| 0070 | npm publish — `tsup` build + dual (dev-src / publish-dist) `exports` via `publishConfig`; 11-package public set incl. `@rifty/shadow-registry`; tag-driven release | — |
| 0071 | Umbrella `rifty` package — one-install front door: subpath re-exports + framework-free `createSandbox()` + `checkCapabilities()` (EPIC B; ratifies DD-1/DD-2) | — |

For the broad rationale and trade-offs, read PROJECT_PLAN.md §8 first; ADRs are the durable spec.
