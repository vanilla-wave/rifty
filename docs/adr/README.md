# Architecture Decision Records

ADRs are immutable while active: a *superseded* ADR is REMOVED (git keeps history) and its load-bearing context grafted into the successor. When only a single *wrong/evolved clause* of an otherwise-active ADR is overtaken, it is corrected in place with a dated note and listed in [Corrections (active)](#corrections-active) — never a silent edit, never a remove of the still-active remainder. New decisions get new ADRs via `pnpm adr:new <area> "Title"`.

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
| 0199 | VFS path contract: absolute-only, loud rejection of relative inputs |
| 0276 | Semantic VFS replacements use applied owner evidence |

### kernel

| # | Title |
|---|---|
| 0011 | Sync IPC via SharedArrayBuffer + Atomics; Worker-as-process model |
| 0012 | `@riftydev/io` owns shared primitives; `@riftydev/kernel` owns processes |
| 0019 | `cwd` lives in `kernel.ProcessRecord` |
| 0039 | Lift Node-API knowledge from kernel to runtime-js |
| 0144 | Kernel server-process model: persistent worker processes (serve) replacing the keep-alive hack |
| 0313 | One-shot opaque Worker entry capability ports |
| 0326 | Federated Worker child tree with separate public IPC and private control |
| 0331 | SyncRpc v3 owns one live exchange through reply consumption |
| 0332 | Worker stdio admission proves terminal drain |
| 0333 | Descendant settlement barrier preserves recursive teardown ordering |

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
| 0142 | node:vm dual-engine — QuickJS real realm default, hardened-rewrite loud opt-in |
| 0152 | Child realm event-loop drain + loud-fail exit contract |
| 0153 | node:constants hybrid faithful static data syscall boundary gap |
| 0158 | Count detached fetch in child-realm event-loop keepalive |
| 0159 | node:zlib web-compression-backed async subset |
| 0162 | Vite 8 Rolldown WASI browser-boot runtime surface |
| 0170 | Auto-discover tsconfig path aliases in runtime loader |
| 0171 | Function constructor dynamic import routing |
| 0178 | node:zlib gzip Transform stream subset |
| 0200 | Persistent ESM transform cache across dev-server child boots |
| 0237 | Readable owns read-hook dispatch and demand latch |
| 0238 | Readable.from defaults to object mode |
| 0239 | fromWeb arguments have one staged validation owner |
| 0240 | Writable completion separates internal and public phases |
| 0267 | Entry-scoped host bootstrap metadata for recursive Node workers |
| 0270 | worker_threads.Worker parent events are EventEmitter-only |
| 0272 | Late typed process terminal bootstrap |
| 0294 | Node-compatible require.extensions suffix dispatch |
| 0324 | Callable EventEmitter constructor over one listener state |
| 0325 | CJS module records own Node metadata and lifecycle |
| 0334 | One-shot Node process adoption across bundle boundaries |

### runtime-wasi

| # | Title |
|---|---|
| 0038 | WasiProcessHandle — kernel adapter for WASI guests |
| 0049 | WASI `cwd` option + `AT_FDCWD` and directory-open semantics |
| 0172 | Side-effect-free WASI runner subpath |
| 0193 | runWasi accepts a precompiled WebAssembly.Module |
| 0316 | Retire the vendored esbuild WASI consumer after registry cutover |

### net

| # | Title |
|---|---|
| 0010 | `node:https` registered as a loud-throw stub |
| 0017 | `@riftydev/net` scope statement and streaming rewrite deferral |
| 0054 | Effect `@effect/platform-node` consumes rifty `node:http` AS-IS via additive shape-widening |
| 0065 | `node:sqlite` `DatabaseSync` WASM shim — sql.js, in-memory-first (P2 boot prerequisite) |
| 0147 | Default cross-realm WebSocket bridge |
| 0151 | HTTP WebSocket upgrade over bridge |
| 0154 | HTTP stream interop and drain contract |
| 0180 | Cross-realm http.request loopback via the preview broker |
| 0181 | Client node:https request and get over browser fetch |
| 0186 | Cross-realm EADDRINUSE via per-port bind-claim broadcast |
| 0189 | Preview loopback WebSocket bridge |
| 0315 | Report the effective virtual server address |

### service-worker

| # | Title |
|---|---|
| 0002 | Cross-origin isolation is mandatory |
| 0016 | Service Worker source-of-truth lives in `@riftydev/service-worker` |
| 0097 | Preview frame port context routes root-relative requests |
| 0123 | Port-aware preview owner routing |
| 0125 | Preview owner binding — async resolution, ready-window preference, clientId sentinels |
| 0160 | Window owner ports and anti-hijack ready-frame routing |
| 0265 | Owner-correlated preview readiness by PTY run |
| 0271 | Correlated service-worker control proofs fence Workbench preview revocation |

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
| 0134 | install() per-package progress hook (onPackage) |
| 0156 | Typed browser shim registry and wasm32 native policy |
| 0163 | Yandex Cloud streaming npm-registry proxy |
| 0175 | Bounded-concurrency packument prefetch in npm install |
| 0176 | Cache headers for npm registry proxy |
| 0182 | Eddy opt-in fast-install resolver |
| 0188 | Install-time shadow internals shims with companion pins and substitution provenance |
| 0194 | eddy v1.2 — stateless bundle store, shared resolve caches, learned pins |
| 0195 | Eddy wire protocol v1.1 — GET-by-hash, CORS-simple POST, streaming client, prefetch seam |
| 0201 | Bounded-fetch chokepoint: no-progress stall bounds on all npm-client fetches |
| 0258 | Structured install acquisition provenance |
| 0283 | Canonical package manifest serialization |
| 0303 | Direct roots reserve flat slots before transitive placement |
| 0309 | One package-tree authority for install-tree lifecycle |
| 0314 | Cancellable package acquisition |
| 0318 | Retain verified shadow assets for manager lifetime |
| 0321 | Keep shadow asset port correlation package local |
| 0335 | Shadow recipe v2 owns materialized bin claims; npm reify owns collision settlement |
| 0343 | Auto-injected companions do not claim package bins without ordinary demand |
| 0344 | Exact Sass twin exposes named positive surfaces; gaps require observed unsupported behavior |

### playground

| # | Title |
|---|---|
| 0003 | Playground UI on SolidJS, isolated from core |
| 0007 | Chrome-first with cross-browser infrastructure from M0 |
| 0073 | Playground UX overhaul — preset gallery, design system, production worker bundling, honest preview status |
| 0075 | Playground VSCode-style shell — bottom console panel, resizable/collapsible splitters, VFS file explorer, multi-model editor tabs |
| 0076 | Cross-realm reverse VFS snapshot — explorer reflects the real-vite worker project; source files editable through the write port |
| 0077 | Real Vite preview renders — worker lifetime, log surfacing, and SW frame routing |
| 0078 | Generic ProjectSpec/Template runtime for the playground (Vite as the default template) |
| 0079 | Single generic project/template switcher; retire the header mode toggles |
| 0080 | Lazy `node_modules` remote-read protocol + async explorer path |
| 0095 | Dev-mode HMR routes through the cross-realm bridge (pluggable dev-server transport) |
| 0124 | Soft Panels visual redesign adopts the Gravity UI handoff |
| 0126 | Preview reloads are HMR-client-driven; snapshot-driven iframe reload removed |
| 0130 | Node-server project template runtime (Express + node:sqlite demo) |
| 0135 | Sandbox setup kinds: instant vs from-scratch |
| 0140 | JetBrains Mono throughout playground |
| 0145 | Real Vite module HMR (server.hmr.channels path superseded) |
| 0155 | Terminal node-file command: arbitrary-entry supervised child + multi-port preview |
| 0157 | Unified spec-seeded mutable Node process at pre-entry gated to Node workers |
| 0161 | Vite 8 disables HMR pending socket parity |
| 0165 | Multi-project management with durable scratch |
| 0173 | Vite 7 production build and preview |
| 0174 | Run vite through installed bin |
| 0184 | Hoist commit-refusal classifier to git facade |
| 0185 | Owner-backed SCM and file-manager bridges |
| 0187 | Install-stamp durability via write-through FIFO order plus verified stamps |
| 0243 | Visible Vite config ownership via durable root-local seed claim |
| 0261 | Root-bound serialized install trust claims and non-transferable claim ingress |
| 0281 | Cmd+S is a workspace durability barrier |
| 0285 | Expose one Workbench health and recovery authority |
| 0286 | Workspace archives round-trip observable Git and nested dot-rifty state |
| 0284 | Git status entries preserve per-path classification gaps |
| 0292 | Workbench authorities replace Solid orchestration core |
| 0293 | Tab-independent workspace admission UX |
| 0307 | Install trust is an install-protocol commit, not tree surveillance |
| 0317 | Vite 8 build and preview through installed CLI |
| 0320 | Define instant restore runtime asset availability |
| 0327 | Installed nodemon owns the Workbench Node-server dev loop |
| 0329 | Authority-owned project Save rebinds exact installed-tree trust |
| 0336 | Exact Vite 8 projects pin the proven Rolldown WASI runtime |

### toolchain-build

| # | Title |
|---|---|
| 0001 | Monorepo on pnpm workspaces |
| 0043 | Vite-in-Worker realm and cross-realm preview bridge |
| 0070 | npm publish — tsup build + dual (dev-src / publish-dist) exports |
| 0071 | Umbrella `@riftydev/sdk` package — one-install front door |
| 0131 | Public sandbox filesystem API for AI agents |
| 0132 | TS ESM parity uses full-transform Node reference |
| 0164 | Node 24 as the supported and parity-target version |
| 0166 | In-browser TS language service over VFS |
| 0177 | Workspace TypeScript is required for TS language service |
| 0196 | Browser-unit test lane is a thin Playwright harness on the playground dev server |
| 0226 | Upstream-derived Vite esbuild runtime over guest VFS |
| 0242 | Generated esbuild diagnostic provenance and target errno normalization |
| 0255 | Disposable worker realm for seeded-process parity cases |
| 0312 | Keep synchronous SHA-256 implementations layer-local |
| 0323 | Gate heavy PR tests on code-affecting changes |
| 0338 | TTY parity composes exact one-axis native resize traces |

### protocol

| # | Title |
|---|---|
| 0031 | Every SW↔main wire frame carries `version`, receivers validate at decode |
| 0032 | SyncRpc protocol-version field in the SAB header |
| 0036 | Preview-protocol addressing in `@riftydev/io` |
| 0040 | SW frame and routing versions split |
| 0048 | Streaming cross-realm preview wire-frame |
| 0183 | Scoped cross-realm preview responders |

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
| 0143 | Bin/shell execution model: owner-worker vs SAB fs-proxy |
| 0146 | PTY channel and owner-resident shell — ADR-0143 P2 |
| 0148 | Unified workspace owner co-resident dev-server and single source of truth ADR-0143 P4 |
| 0150 | Supervised child processes over SAB sync-views (D P6) |
| 0167 | git capability over VFS via isomorphic-git |
| 0198 | Byte-transparent shell data plane; string display plane |
| 0256 | Owned abort settlement and asynchronous shell disposal |
| 0257 | Exact process exit through shell command results |
| 0330 | Lifecycle failures remain exceptional through Shell |

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
| 0225 | Cross-realm PTY resize control plane |
| 0230 | Owner PTY stdin pump for supervised Node children |
| 0264 | Owner-acknowledged idle PTY dimensions |

### distribution

| # | Title |
|---|---|
| 0263 | Workbench Playground companion subpath |
| 0273 | Workbench files and documents handle contract |
| 0274 | Session-scoped opaque Workbench file versions |
| 0275 | Owner-applied project mutation stream |
| 0278 | Playground companion terminal state and preview registry |
| 0279 | Compact staged Playground catalog transactions |
| 0280 | Project-rooted terminal execution namespace |
| 0282 | Extraction-safe Playground host and session seams |
| 0311 | Registry-owned esbuild runtime removes the host asset URL |
| 0319 | Preserve admitted mutations across project close |

## Superseded (removed)

ADRs below were removed; load-bearing context grafted into the successor. See git history.

| removed | superseded by | note |
|---|---|---|
| 0013 | 0072 | OPFS hot path; context grafted |
| 0025 | 0043 | dev-server realm; page-realm globals-guard grafted |
| 0028 | 0133 | prod npm-registry proxy; deploy/routing/env contract reshaped, context grafted |
| 0133 | 0163 | prod npm-registry proxy moved from Netlify Function to Yandex Cloud streaming Compute proxy; context grafted |
| 0044 | 0316 | swc/WASIp1 discovery retained; product carrier retired |
| 0047 | 0316 | real WASIp1 proof becomes package-sourced; vendored M8/M10 carrier removed |
| 0046 | 0125 | owner-binding seam; microtask invariant dropped, context grafted |
| 0055 | n/a | retired opencode facade ADR; integration cancelled |
| 0074 | 0077 | SW preview-nav routing; ported into ADR-0077 |
| 0092 | n/a | retired opencode facade ADR; integration cancelled |
| 0138 | 0142 | eval interception now feasible via QuickJS real realm; context grafted |
| 0169 | 0177 | workspace TypeScript rule; absent-workspace vendored fallback removed |
| 0216 | 0261 | background durability, learned-pin SWR, and stamp fault history grafted |
| 0224 | 0263 | sealed root retained; finite Playground companion owns first-party plans/tools without exposing the owner |
| 0241 | 0261 | exact request/artifact identity and snapshot migration grafted |
| 0231 | 0267 | host bootstrap leaves guest `process.env`; recursive-worker context grafted |
| 0260 | 0276 | shared guard law retained; closed vocabulary gains applied-evidence semantic replacement |
| 0277 | 0278 | finite plans/catalog/TS/SCM/archive grafted; terminal state and owner preview registry added |
| 0179 | 0284 | git-facade ownership retained; scalar result replaced by ordered rows plus explicit path gaps |
| 0197 | 0292 | Solid testability motive retained; Workbench companion now owns lifecycle and semantic test seams |
| 0269 | 0294 | shared table and `_compile` retained; `.js`-only dispatch replaced by Node suffix selection |
| 0045 | 0326 | dedicated MessagePort rationale retained; unconditional structured-clone fork IPC and mixed public/control frames replaced |
| 0308 | 0328 | generic registry retained; recipe v2 adds admission, exact dependency projection, and materialization-owned bins |
| 0328 | 0335 | recipe-v2 authority retained; lexical-min/every-install settlement replaced by npm reify operation history and a loud collision ceiling |
| 0337 | 0338 | raw trace retained; permissive comparator replaced by exact one-axis native resize steps |
| 0310 | 0344 | Pattern-1 carrier retained; impossible generic unproven-surface gap replaced by finite positive claims and RED-first specific gaps |

## Corrections (active)

Active ADRs below carry in-place correction notes; only the named clause is
superseded.

| ADR | corrected by | note |
|---|---|---|
| 0032 request-state release / current-version clauses | 0331 / note 2026-07-27 | SyncRpc v3 retains a claimed request through versioned reply consumption |
| 0084 #17 `inFlight` guard / #18 early release clauses | 0331 / note 2026-07-27 | shared `HANDLING` is sole exchange authority through caller consumption |
| 0011 worker-exit / raw-output handoff clauses | 0332 / note 2026-07-27 | child seal authenticates exit; runtimes receive semantic output writers |
| 0038 raw stdout/stderr `MessagePort` handoff clauses | 0332 / note 2026-07-27 | runtimes receive semantic byte writers; kernel retains ports and output-cut state |
| 0039 deferred stdio abstraction-lift clause | 0332 / note 2026-07-27 | `KernelProcessSpec` exposes semantic writers; kernel retains output transport |
| 0122 stdout/stderr port-matching clause | 0332 / note 2026-07-27 | stdin remains port-backed; stdout/stderr use semantic byte writers |
| 0157 four-stdio-port / `makeStdioWriter` clauses | 0332 / note 2026-07-27 | stdout/stderr are kernel semantic writers; stdin and IPC remain ports |
| 0326 unspecified final-output drain authority | 0332 / note 2026-07-27 | one process-wide cut and exact per-stream committed targets prove drain |
| 0326 unspecified descendant-settlement/output-cut order | 0333 / note 2026-07-27 | fence admission, signal exact routes child-first, then await close-checkpoint settlement or peer death before the ancestor output cut |
| 0011 recursive private PID allocator clause | 0326 / note 2026-07-26 | recursive children reserve owner-root ProcessManager identities over the trusted SAB attachment |
| 0012 realm-local unified-registry clause | 0326 / note 2026-07-26 | one federated owner-root process tree; nested managers own only direct physical Workers |
| 0130 D4 generated direct-command selector | 0327 / note 2026-07-26 | exact script bytes select canonical direct entry versus installed `.bin`; no template-ID dispatch |
| 0146 PTY-over-fork-IPC clause | 0326 / note 2026-07-26 | PTY frames use the private control lane on the same physical port |
| 0150 P6b fork-control / all-node-server dedicated path clauses | 0326 + 0327 / note 2026-07-26 | private frames carry control; only canonical direct-entry scripts use the dedicated controller |
| 0155 public `rifty:node-listening` clause | 0326 / note 2026-07-26 | typed private descendant control reports listening/removal/physical exit |
| 0157 unconditional process IPC / `postListening` clauses | 0326 / note 2026-07-26 | public JSON IPC exists only for fork; private host adapter reports lifecycle |
| 0162 worker-thread IPC lane clause | 0326 / note 2026-07-26 | worker threads keep structured clone and thread identity, outside the process table |
| 0174 generic `.bin` dedicated-node lifecycle wording | 0327 / note 2026-07-26 | installed nodemon uses generic `.bin`; canonical direct scripts retain their controller |
| 0267 v1-only bootstrap-shape clause | 0326 / note 2026-07-26 | atomic v2 adds exact public-IPC discrimination with no dual reader |
| 0042 global first-wins-flat clause | 0303 | surviving direct identities reserve root-visible slots before serial descendant first-wins placement |
| 0175 globally request-ordered placement clause | 0303 | direct reservation precedes descendant DFS; prefetch/network completion remains non-authoritative |
| 0263 generic origin-contention rejection clause | 0293 / note 2026-07-18 | callback-null origin contention has public `WorkbenchOriginOccupiedError`; same-page/capability/request/init failures remain fatal |
| 0263 four-worker/extraction clauses | 0282 / note 2026-07-16 | companion host supplies dedicated TypeScript worker; sealed semantic operations replace private App imports |
| 0278 exact session-tools / legacy-prefix conversion clauses | 0282 / note 2026-07-16 | TS recovery, durability wait, and root-free terminal restoration are public companion semantics |
| 0278 depth-insensitive archive `.git`/`.rifty` exclusion clause | 0286 / note 2026-07-17 | Git and nested ordinary `.rifty` round-trip; root `.rifty` remains private |
| 0281 package-private durability operation clause | 0282 / note 2026-07-16 | `awaitDurability()` is public but exposes no backend, report, path, owner, or transport |
| 0276 exact-preplan-or-loud-throw Git clause | 0276 note 2026-07-15 | opaque lower-level worktree plans may use a repo replacement candidate; applied owner endpoints remain the only reset evidence |
| 0010 every-method-throws / terminal-state clause | 0181 | client `request`/`get` route over host `fetch()`; `createServer`/`Agent`/TLS options still loud-throw |
| 0017 A-025 deferral clause | 0147 | cross-realm WebSocket reachability shipped; M12 still owns streaming/backpressure |
| 0017 A-024 raw TCP clause | 0017 note 2026-06-18 | raw OS TCP is a final browser ceiling; connect APIs throw directed `NotImplementedError`s |
| 0015 preview1 redirect / `esbuildShimFiles` consolidation clauses | 0316 / note 2026-07-24 | registry remains the substitution owner; catalog-owned esbuild-wasm recipe replaces the legacy esbuild carriers |
| 0027 third-shim promotion trigger | 0156 | Vite browser shims now use the typed `browserShimFileSets` registry |
| 0027 esbuild per-file overlay clauses | 0316 / note 2026-07-24 | synthetic esbuild package replaces only esbuild; typed overlays remain for Rollup and LightningCSS |
| 0036 `synthesizePreviewUrl(path)` host clause | 0189 / note 2026-07-04 | SW preview HTTP routing now synthesizes `localhost[:port]`; `PREVIEW_LOCAL_HOST=preview.local` remains for explicit legacy HMR bridge paths |
| 0040 synthetic host bump-trigger clause | 0189 / note 2026-07-04 | `SW_ROUTING_VERSION` pins `synthesizePreviewUrl` Host synthesis, not the legacy `PREVIEW_LOCAL_HOST` literal alone |
| 0011 A-008 / M11 checked-in WASI esbuild carrier | 0316 / note 2026-07-24 | registry esbuild-wasm is the sole product runtime; preview1 is an explicit package-sourced guest |
| 0051 accepted WebAssembly CPU targets | 0156 | `wasm32` is admitted alongside `wasm`; native platform packages remain unsupported |
| 0051 esbuild post-install overlay premise | 0316 / note 2026-07-24 | registry substitution replaces the retired preview1 overlay; native policy stands |
| 0052 vendored-WASI transform provider premise | 0316 / note 2026-07-24 | public hook stays provider-neutral; Node parity injects host esbuild and product proof uses registry admission |
| 0053 vendored-WASI transform provider premise | 0316 / note 2026-07-24 | resolver behavior stands; no provider is prescribed |
| 0070 shadow-registry esbuild-binding / published esbuild-transform exports | 0316 / note 2026-07-24 | both carrier subpaths removed; pure internal catalog replaces the transform surface |
| 0135 baked snapshot contains preview1 carrier | 0316 / note 2026-07-24 | snapshots use registry-owned substitutions; setup semantics stand |
| 0135 instant zero-network clause | 0320 | instant skips npm install; an empty verified Vite 7 runtime CAS performs the exact esbuild-wasm acquisition or fails loudly offline |
| 0172 Playground vendored-WASI consumer consequence | 0316 / note 2026-07-24 | public side-effect-free runner remains; product esbuild no longer consumes it |
| 0173 vendored-WASI build preparation clauses | 0316 / note 2026-07-24 | registry esbuild-wasm owns product builds; installed Vite ownership stands |
| 0173 D5 Vite 8 build/preview loud-reject clause | 0317 / note 2026-07-25 | exact Vite 8.0.16 builds and previews through the installed CLI; Vite 7 remains default and Vite 8 HMR stays off |
| 0188 esbuild alias placement / preview1 redirect clauses | 0316 / note 2026-07-24 | synthetic registry recipe replaces only esbuild; rollup/lightningcss and generic installer/provenance rules stand |
| 0193 Playground esbuild bridge consumer premise | 0316 / note 2026-07-24 | public precompiled-Module and cross-realm behavior remain without a product esbuild consumer |
| 0226 D6 vendored WASI CLI remains | 0316 / note 2026-07-24 | exact preview1 package is an explicit guest; registry esbuild-wasm is the sole product runtime |
| 0263 host-resolved esbuild WASM deployment field | 0311 / note 2026-07-24 | registry recipe owns esbuild runtime bytes; other host-resolved deployment assets stand |
| 0078 Vite runtime/config fields and direct `createServer` clauses | 0174 / note 2026-07-13 | Vite specs retain install/seed/UI data; installed `.bin/vite` owns execution |
| 0145 browser transport clause | 0147 | browser shim is now the generic WebSocket bridge |
| 0145 `server.hmr.channels` payload path | 0151 | Real-Vite now uses Vite native `server.ws` over rifty `http.Server.on('upgrade')` |
| 0145 Vite 8 default HMR scope | 0161 | Vite 8 template disables HMR until socket/HMR parity is re-proven for the Rolldown WASI path |
| 0145 editor-write/plugin-injection clauses | 0174 / note 2026-07-13 | installed Vite polls the owner VFS; curated invalidation IPC/plugin injection are retired |
| 0150 P6b Vite/file-change-IPC clauses | 0174 / note 2026-07-13 | dedicated child is node-server-only; Vite uses the generic `.bin` child; fs.* invariant stands |
| 0161 `ProjectSpec.hmr` policy owner | 0174 / note 2026-07-13 | visible seeded Vite config owns Vite 8 `server.hmr: false` |
| 0173 curated Node-API runner clause | 0174 / note 2026-07-13 | installed CLI owns build/preview/config/args; old helpers are deleted |
| 0174 deferred curated-helper cleanup | 0174 note 2026-07-13 | direct Vite/helpers/file-change IPC deleted; installed `.bin/vite` is the only Vite path |
| 0165 Starter bundle shape | 0165 note 2026-06-29 | preset `source` overlay removed; `files[]` is the ordinary file bundle and must include the template entry |
| 0166 D-a vendored fallback clause | 0177 | workspace-installed `node_modules/typescript` is required; missing or broken workspace TS fails loudly |
| 0066 explicit-only tsconfig paths clause | 0170 | `autoDiscoverTsconfigPaths` can opt into TypeScript-parser-backed tsconfig discovery; default remains explicit/off |
| 0054 WS/SSE upgrade risk note | 0151 | WebSocket `server.on('upgrade')` now works over the bridge; SSE stays streaming HTTP |
| 0054 pipe-sink deferral | 0154 | `Readable.fromWeb(webStream).pipe(res)` is implemented; full `node:stream/web` remains unclaimed |
| 0151 control-frame keepalive clause | 0151 note 2026-06-19 | control frames relay end-to-end; the peer answers pings (real `ws` auto-pongs + `'ping'`, browser-like clients silently pong), transport no longer auto-pongs |
| 0152 §1 narrow-set / network gap | 0158 | global `fetch` now counted (ref on dispatch, held until body consumed); dispatcher backstop moved to an uncounted host timer; §1 shape unchanged, named set grew |
| 0155 §5 loud-only interactive-stdin clause | 0230 / note 2026-07-13 | owner PTY pump ships flowing stdin, explicit EOF, and pause/resume; ADR-0225 ships live resize; pull/raw gaps stay loud |
| 0157 §4 forward-target/interim-guard clause | 0230 / note 2026-07-13 | Node and `.bin` children consume flowing stdin; pull/raw surfaces remain exact loud gaps |
| 0135 §4 slug = preset.id reuse key | 0165 | multi-project: install-stamp slug becomes project-scoped (`slug=projectId\|'scratch'`); same-Starter projects must not share node_modules; cleanup fires on root/projectId change |
| 0090 H1/checklist drift | 0185 / note 2026-06-29 | filename/index `0090` is authoritative despite the body H1 typo; VFS primitives shipped earlier, and playground rename now uses `renameSync` instead of `copyTree`+`rm`; `vfs/native-renamesync` backlog item removed |
| 0187 "durable stamp implies durable tree by FIFO order alone" clause | 0187 note 2026-07-04 | per-op persist failures were swallowed; `OpfsFsSync.flush()` now returns a persist-failure ledger report; the visible `npm install` gates the stamp on a clean drain, the boot/restore stamp stays non-blocking by writing an untrusted pending stamp and promoting it only after a clean deferred drain |
| 0195 rejected "client-persisted dep-set→hash map" | 0194 §8 | learned pins implement it — a new project in the same profile has no stamp (measured 2026-07-02: full origin POST vs ~0 browser-cache GET); TTL + the same verification gates keep staleness safe |
| 0182 launch speed quote | 0182 note 2026-07-07 | production `auto` browser benchmark is 1.88x; the older ~6x remains only the Node/sandbox model, and h2/h3 claims stay gated by the transport-matrix item |
| 0187 command-site "returns only when durable" clause | 0261 | `npm install` exit no longer awaits the drain; one stamp authority fences mutation and promotes in background (every other 0187 clause stands) |
| 0194 §8 learned-pin 30-min hard-TTL clause | 0261 | freshness is SWR: fresh <1800s, stale from 1800s to <24h, dropped at 24h |
| 0261 every copied project reinstalls consequence | 0329 | ordinary copies stay untrusted; authority-mediated destructive Save rebinds exact trust after destination proof |
| 0194 deferred upstream-registry lever | 0194 note 2026-07-07 | on-VM A/B resolved the fork: eddy now uses direct `https://registry.npmjs.org`; the browser standard install path still uses the CORS registry proxy |
| 0188 bridge-backed dual esbuild entries | 0226 / note 2026-07-13 | one install-time CJS overlay reads the exact Worker-owned runtime slot; other 0188 installer/shim/provenance clauses stand |
| 0237 non-undefined runtime signal clause | 0239 / note 2026-07-12 | falsy signal is absent; invalid signal errors preserve Node acquisition order; valid supported signal stays a pre-lock loud gap |
| 0075 permanent program tab / program-model guard | 0075 note 2026-06-29 | initial tabs are preset/project-owned ordinary file tabs (`openFiles`), path-keyed by absolute VFS path; no `PROGRAM_TAB_ID`/program model; same-path opens reuse one model |
| 0076 Program-tab safety paragraph | 0076 note 2026-06-29 | real-vite entry/source files use the ordinary path-keyed editor write path; no special program tab; writes still reach owner/worker, so no silent copy |
| 0097 synthetic upstream URL example | 0189 / note 2026-07-04 | preview-frame port context unchanged; `routePreview` forwards `localhost:<port>` upstream URLs |
| 0137 backlog path / follow-up status | 0137 note 2026-06-23 | shell `.bin` execution backlog file retired after owner-worker child path + non-dev `npm run` routing landed; `execSync` node-entry residual remains separate |
| 0143 pre-ADR backlog reference | 0143 note 2026-06-23 | pre-ADR analysis backlog file retired after shell `.bin` transport closure; ADR-0143 remains the historical record |
| 0144 owner CLI in-realm phrase | 0144 note 2026-06-23 | `.bin` commands now run in supervised child workers over owner remote-fs; `execSync` node-entry residual remains separate |
| 0146 P2 wholesale owner-shell target | 0146 note 2026-06-23 | delivered package-tooling slice closes `.bin` via owner-worker child execution; `execSync` node-entry residual remains separate |
| 0159 Transform-stream deferral | 0178 | `createGzip()` / `Gzip` landed for the Vite preview compression consumer; the rest stays loud |
| 0159 one-shot flush knobs | 0159 note 2026-06-29 | `flush` / `finishFlush` are behavior-affecting and now throw instead of being accepted no-ops |

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

- `PROJECT_PLAN.md` → `AGENTS.md` (mission/scope) + `docs/adr/` (architecture decisions) + `docs/ROADMAP.md` (milestones)
- `docs/ARCHITECTURE.md` → `AGENTS.md` §Mission (vision/scope) + `docs/adr/` (strategic decisions D-001..D-006, isolation, COI)
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
- `docs/backlog/playground/terminal-node-command.md` — completed backlog item, removed on close; the record is ADR-0155 + the code (ADR-0130/0155 still cite it)
- `docs/backlog/runtime-js/execsync-node-entry-loader.md` — completed backlog item, removed on close; `execSync`'s child now routes through the node-entry module loader (shebang + relative imports), the record is ADR-0137/0143/0150 + the code (ADR-0137/0143/0146 + `docs/backlog/shell/d-owner-worker-milestone.md` still cite it)
- `docs/backlog/kernel/worker-per-process-residuals.md` — completed backlog item, removed on close; ADR-0230 + runtime stdin parity are the record (ADR-0155/0157 still cite it)
- `docs/backlog/shell/pty-live-resize.md` — completed backlog item, removed on close; ADR-0225 + terminal/worker resize tests are the record

Retired ADR numbers (process moved to `AGENTS.md` / `docs/process/decision-workflow.md`, no longer recorded as ADRs): **0008, 0022, 0024, 0033, 0063, 0064, 0081**. Older ADRs may still cite these — they resolve there, not to a file. Older docs may also cite `CLAUDE.md` — it is a symlink to `AGENTS.md`. `tools/refs/check.mjs` treats them as retired so the citations don't dangle. (0081 = reversibility rule 4 "record decisions, not diffs"; its rule text is grafted into `docs/process/decision-workflow.md`.)
