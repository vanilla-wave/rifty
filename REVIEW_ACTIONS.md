# Architecture review — action items

Source: review of repo conformance to `PROJECT_PLAN.md` (12 parallel agents over M0-M10 + cross-cutting layer), 2026-05-24.

**Update 2026-05-24 (auto-decisions session):** all 40 items processed. Each has a status: `RESOLVED` (fixed this session), `ADR-NNNN` (decision designed, implementation deferred), or `PROMOTED` (the corresponding OPEN_QUESTIONS entry moved to ADR/Rejected). See `~/ai/superpowers/specs/2026-05-24-review-actions-design.md` and `~/ai/superpowers/plans/2026-05-24-review-actions-plan.md`.

Priorities:
- **P0** — foundational gaps; break accepted ADRs or create the illusion of a working system.
- **P1** — process / hard-rule (CLAUDE.md) violations; DONE flags detached from reality.
- **P2** — tech debt, traps on later milestones, doc/code drift.

Reversibility classification (per CLAUDE.md §"Reversibility" checklist): I — IRREVERSIBLE, R — REVERSIBLE.

---

## P0 — foundational gaps

### A-001 [I] execSync via SAB+Atomics not implemented
**Status:** RESOLVED (2026-05-25, ADR-0011 phase 3). ADR `docs/adr/0011-sync-ipc-sab-atomics.md` is now fully implemented: phase 1 (SAB ring), phase 2 (worker-per-process), phase 3 (sync `execSync` via `Atomics.wait`).

Phase 3 surface:
- `packages/kernel/src/ipc/sync-rpc.ts` — JSON-over-UTF-8 RPC framing (`SyncRpcRequest`/`SyncRpcReply` + `encode*`/`decode*`).
- `packages/kernel/src/ipc/sync-dispatch.ts` — `SyncRpcDispatcher` (parent-side polling, attach/detach per ring, in-flight guard).
- `packages/kernel/src/ipc/sync-client.ts` — `SyncRpcClient` (in-Worker `Atomics.wait` blocking call); throws `NotImplementedError` if called from the main realm.
- `packages/kernel/src/ipc/default-handlers.ts` + `recursive-runner.ts` + `script-resolver.ts` — kernel default `execSync` handler recursively spawns a new Worker, captures stdout, returns a string.
- `packages/kernel/src/worker-entry.ts` — publishes `__riftyKernelSyncCall(method, payload)` (key: `KERNEL_SYNC_CALL_KEY`) for the runtime-js layer.
- `packages/runtime-js/src/builtins/child_process-sync.ts` — `execSync` branches: SAB hook when `isSabIpcSupported() && getKernelWorkerUrl() && globalThis[KERNEL_SYNC_CALL_KEY]`; otherwise falls back to in-realm `new Function`.

2 conformance tests: `tests/conformance/kernel/sync-rpc.test.ts` (real Node Worker round-trip — echo + ERPCNOHANDLER); `tests/conformance/builtins/exec-sync-worker.test.ts` (skips in Node without isolation, documents the contract for browser e2e).

### A-002 [I] "Process = Web Worker" not implemented
**Status:** RESOLVED (2026-05-25, ADR-0011 phase 2). `kernel.spawnWorker(spec)` creates a real `new Worker(kernelWorkerUrl, { type: 'module' })` under a unique PID with a SAB ring + 3 stdio `MessageChannel`s; exit is tracked via the worker's `{type:'exit', code}` message. `setKernelWorkerUrl` / `getKernelWorkerUrl` let the host (playground) pass a Vite-resolved URL without hardcoding paths in `@riftydev/kernel`. `child_process.spawn` / `fork` and `worker_threads.Worker` branch on `isSabIpcSupported() && getKernelWorkerUrl()`; otherwise fall back to the in-realm path (per ADR-0011). 2 conformance tests under `tests/conformance/builtins/child_process-worker.test.ts` (skip in Node without COOP/COEP).

### A-003 [R] `packages/io` and `packages/kernel` — dead scaffolding
**Status:** RESOLVED (2026-05-25, ADR-0012 implemented). `@riftydev/io` now owns `EventEmitter`/`Buffer`/`Readable`/`Writable`/`Duplex`/`Transform`/`PassThrough`/`pipeline`/`finished` + `NotImplementedError`. `runtime-js/builtins/{events,buffer,stream}.ts` and `kernel/src/internal/event-emitter.ts` are re-export shims. `child_process.spawn` allocates PIDs via `globalProcessManager.spawn(...)` (kernel ProcessManager). `worker_threads.Worker` PIDs stay on a separate counter until the ADR-0011 worker-as-process migration.

### A-004 [R] OPFS unused — persistence doesn't work
**Status:** RESOLVED (2026-05-26). ADR-0013 (`docs/adr/0013-opfs-vfs-deployment.md`). **Update 2026-05-24 (M11):** code path landed — `packages/vfs/src/boot.ts` exposes `detectVfsBackend()` (returns `'opfs'` iff `crossOriginIsolated && OpfsVfs.isSupported()`) and `initBackend()` which calls `installOpfsFs()` when applicable. **Update 2026-05-26 (bootstrap consolidation):** playground bootstrap wiring landed — `bootstrapPlayground()` in `apps/playground/src/boot.ts` orchestrates COI assert (ADR-0002) → `initBackend()` (VFS) → `registerServiceWorker('/sw.js')` as a single awaited pipeline, awaited in `main.tsx` before `render(...)`. SW registration is no longer raced inside `App.onMount`; failures flow through `BootResult.swError` to the existing dismissible banner. E2E reload assertion added in `tests/e2e/m0-boot.spec.ts` (`write file -> reload -> file persists (OPFS round-trip, A-004)`), exercising `/workspace/persist.txt` survival across `page.reload()`. Remaining OPFS work (chunked streaming, quota error path) tracked separately under A-020 phase 2.

### A-005 [I] Sync via `FileSystemSyncAccessHandle` not implemented
**Status:** **Closed — scope fixed, not deferred** (2026-05-26 decision, see ADR-0013 top-of-file). `OpfsFsSync` file ops (`existsSync`, `readFileBytesSync`, `writeFileSync`, `statSync`) implemented via `FileSystemSyncAccessHandle`. Directory ops permanently throw `NotImplementedError('OpfsFsSync.<method>', 'directory ops require an async bootstrap; use OpfsVfs for those')` — the `FileSystemSyncAccessHandle` platform API has no directory variant by design, so callers route through the paired async `OpfsVfs`. The constructor refuses to run outside a Worker realm with `NotImplementedError('OpfsFsSync', 'sync OPFS only available inside a Web Worker realm')`. Browser e2e round-trip is a separate M11 follow-up (see A-004).

### A-006 [I] Two VFS in parallel — no "single source of truth"
**Status:** ADR-0014 (`docs/adr/0014-shared-vfs-backing-tree.md`). **Decision (2026-05-26):** implement in **M11 (end of June 2026)**. Sketch: a process-wide `MemoryBackend` singleton owns the in-memory tree; `MemoryVfs` (async view) and `MemoryFsSync` (sync view) are thin wrappers over it. The OPFS pair (`OpfsVfs` + `OpfsFsSync`) share an OPFS directory handle + an in-memory `Map<string, FileSystemSyncAccessHandle>`. WASI preopens use the same backend instance. `installMemoryFs()` / `installOpfsFs()` are the only call sites that mint a backend.

### A-007 [I] D-005 shadow-registry is symbolic
**Status:** RESOLVED — ADR-0015 implemented (2026-05-24). `tools/shadow-registry/` is a new workspace package `@riftydev/shadow-registry` with `bakedOverrides`, `esbuildShimFiles`, `rollupShimFiles`. `packages/npm-client/src/overrides.ts` and `apps/playground/src/adapters/esbuild-shim.ts` are now thin adapters/re-exports. `unenv` stays deferred until a concrete trigger (see ADR-0015 §Decision).

### A-008 [I] esbuild-shim — passthrough; M10 finale is fake
**Status:** Deferred to **M11 toolchain push** (2026-05-26 decision, see ADR-0011 §"M11 follow-up — esbuild.wasm via WASI"). Scope: vendored `esbuild.wasm` under `tools/esbuild-wasm/`, WASI preopens for esbuild's tmpdir (mapped via ADR-0014 shared backend), stdin/stdout through kernel-spawned Worker stdio `MessagePort`s from ADR-0011 phase 2. The `esbuild-shim` adapter in `apps/playground` swaps from passthrough to spawning a kernel Worker + WASI runner.

---

## P1 — process / hard rules / DONE flags

### A-009 [R] TASKS.md marks M0/M4/M6/M7/M8/M9/M10 DONE with unmet acceptance
**Status:** RESOLVED — `TASKS.md` updated; these milestones are now `PARTIAL — see open acceptance below` with an explicit list of open items.

### A-010 [I] Q-005 (subpath exports) merged without stop+PR
**Status:** PROMOTED → ADR-0018 (`docs/adr/0018-runtime-js-subpath-exports.md`). Retroactive acceptance: signs off the public contract on `./builtins/{process,timers,buffer,module}`; the `./host` consolidation option stays for the future. Q-005 moved to the "Promoted" section of `OPEN_QUESTIONS.md`.

### A-011 [R] Q-006 (`https → http` alias) — silent stub
**Status:** RESOLVED + PROMOTED. Created `packages/net/src/https.ts` — a loud-throw stub (import works; any call throws `NotImplementedError`). `register-builtins.ts` updated. 5 conformance tests in `tests/conformance/builtins/https.test.ts`. ADR-0010 ratifies. Q-006 → "Rejected" in `OPEN_QUESTIONS.md`.

### A-012 [R] `check:isolation` not run in CI
**Status:** RESOLVED — `.github/workflows/ci.yml` job `lint-and-typecheck` now calls `pnpm check:isolation` after `pnpm check:deps`.

### A-013 [R] `check:deps` stale — an undeclared cycle exists
**Status:** RESOLVED — the registry (registerBuiltin/listBuiltins/loadBuiltin/isBuiltinSpecifier + cache + factories) is extracted into a new module `packages/runtime-js/src/builtins/registry.ts`. `index.ts` and `module.ts` both import from registry; the cycle is gone. `pnpm check:deps` shows `0 circular`.

### A-014 [I] Layer inversion `net → runtime-js`
**Status:** RESOLVED (2026-05-25, ADR-0012 implemented). `packages/net/src/{http,net,ws}.ts` now import `EventEmitter`/`Buffer`/`Readable` from `@riftydev/io` directly. `grep -r '@riftydev/runtime-js' packages/net/src` shows a single hit — `register-builtins.ts` imports `registerBuiltin` from runtime-js, but that is a forward-direction side-effect entrypoint (`apps/playground` loads it to plug net into the runtime-js loader registry), not a reverse import of primitives.

### A-015 [R] TODO(ADR) markers diverge from OPEN_QUESTIONS.md
**Status:** RESOLVED. (1) Q-005 markers added: in `packages/runtime-js/package.json` (top-level `"// TODO(ADR)"` key) and in `apps/playground/src/adapters/realVite.ts:26-27`. (2) `tools/adr/todo-report.mjs` hardened: parses the `## Active` section of `OPEN_QUESTIONS.md`, greps each Q-id, exits 1 if no marker exists for at least one. Pre-implementation Q's (with `(none — …)` under `### Code markers`) are correctly skipped.

### A-016 [I] No prod COOP/COEP headers
**Status:** RESOLVED — added `vercel.json` (repo root) and `apps/playground/public/_headers` (Netlify/CF Pages). Both set COOP=`same-origin`, COEP=`credentialless`, CORP=`cross-origin`, matching `vite.config.ts`.

### A-017 [R] SW code duplicated
**Status:** RESOLVED (2026-05-24, second sub-session). Vite plugin `apps/playground/build/sw-plugin.ts` bundles `packages/service-worker/src/sw.ts` into `apps/playground/public/sw.js` via esbuild on `buildStart` (build) and on changes in `packages/service-worker/src/` (dev). The TS is the source of truth. The generated `sw.js` is added to biome ignore (build artifact). In parallel, `packages/service-worker/src/preview-bridge.ts` gained default `CORP: cross-origin` + `COEP: credentialless` headers on preview responses (parity with the handwritten version). See ADR-0016.

---

## P2 — tech debt and traps on later milestones

### A-018 [R] Buffer — Uint8Array tag without critical methods
**Status:** RESOLVED. `packages/runtime-js/src/builtins/buffer.ts` extended: `readUInt{8,16BE,16LE,32BE,32LE}`, `readInt{...}`, `readBigUInt64{BE,LE}`, `readBigInt64{BE,LE}`, symmetric `write*`, `swap{16,32,64}`, instance `compare`, static `Buffer.compare`. Plus 17 unit cases in `tests/conformance/builtins/buffer.test.ts` + a new parity case `tools/node-parity-runner/cases/buffer/readwrite.case.ts` (matches Node).

### A-019 [R] `process.cwd()` hardcoded `/`, `chdir` is a no-op
**Status:** ADR-0019 (`docs/adr/0019-cwd-in-process-record.md`). Per-process cwd state in `ProcessManager`; M11.

### A-020 [R] `createReadStream` doesn't stream
**Status:** PARTIAL — phase 1 RESOLVED (2026-05-24, second sub-session), phase 2 deferred **post-A-006** (2026-05-26 decision, see ADR-0020 top-of-file). Phase 1: added `openReadable(path, opts?): Promise<ReadableStream<Uint8Array>>` to the `Vfs` interface (`packages/vfs/src/types.ts`), implemented in `MemoryVfs` (default chunkSize 64 KiB, start/end byte offsets), with stubs in `OpfsVfs` + `SyncMirrorVfs` (throw with a pointer to M11). 5 conformance tests pass. **Phase 2:** gated on ADR-0014 (shared VFS backing tree) landing first — otherwise `OpfsVfs.openReadable` via `File.stream()` from one tree versus the `createReadStream` fallback from another breaks the "single source of truth" from M4/M8. Order: ADR-0014 (M11) → ADR-0020 phase 2 (M11).

### A-021 [R] Inter-process pipes — string bus
**Status:** PARTIAL — ADR-0011 phase 3 implemented JSON-over-UTF-8 framing for sync RPC (see A-001). Binary stdio over MessagePort with backpressure is a separate follow-up: phase 3 framing is JSON, not raw bytes. To be addressed in a separate pass.

### A-022 [I] Chunked transfer encoding and streaming responses absent
**Status:** ADR-0017 — **M12 confirmed (target = end of August 2026)** (2026-05-26 decision). `SerializedResponse` body as `ReadableStream<Uint8Array>` Transferable across realms via the ADR-0011 cross-realm bridge. M12 starts only after M11 ships ADR-0011 worker-as-process — the bridge is a load-bearing primitive.

### A-023 [I] SW → main thread, not SW → Worker
**Status:** ADR-0011 — **M11 confirmed, sequenced after A-026** (2026-05-26 decision). Blocked by the cross-realm port-registry bridge from the Vite-in-Worker migration. After A-026, SW rewires from "post to first window client" → "post to the worker owning the process registered for this URL", reusing the same `MessagePort` registry. Dependency chain: ADR-0011 phases 1-3 (DONE) → A-026 Vite-in-Worker → A-023 SW-to-Worker.

### A-024 [R] `net.Socket` is HTTP-RPC, not TCP
**Status:** ADR-0017 — **M12 confirmed (target = end of August 2026)** (2026-05-26 decision). `net.Socket` gains a full TCP-shape surface: raw byte streaming, `_write`/`_read` honour `chunk` not HTTP frames. Where TCP semantics can't be faithfully emulated in the browser (e.g. `localAddress`), TSDoc declares the limitation as final.

### A-025 [R] WebSocket — same-realm shim
**Status:** ADR-0017 — **M12 confirmed (target = end of August 2026)** (2026-05-26 decision). Cross-realm WS bridge via a dedicated `MessagePort` per connection instead of `BroadcastChannel` (which has no per-connection isolation and no backpressure). Included in the M12 streaming rewrite alongside A-022 / A-024.

### A-026 [R] Vite runs in the main-thread page realm
**Status:** ADR-0011 + ADR-0025 — **M11 confirmed** (2026-05-26 decision). Vite moves from the page realm into a kernel-spawned Worker as soon as the cross-realm port-registry bridge in `@riftydev/net` is ready. The migration is local — replace `realVite.ts` with a worker-spawning version plus the registry bridge. ADR-0025 superseded for the Real Vite path; main-thread Dev Mode stays as a non-isolated fallback. Q-2026-05-23-002 already promoted to ADR-0025.

### A-027 [R] Real packages — on mocks
**Status:** RESOLVED (2026-05-24). ADR-0021 moved to `Implemented`. Vendored under `tests/integration/fixtures/registry/`: `picocolors-1.0.0.tgz` (2.4 KB), `ms-2.1.3.tgz` (2.9 KB), `kleur-4.1.5.tgz` (6.0 KB) — all zero-dep. `manifest.json` + per-package `<name>.json` + `local-registry.ts` (a Fetcher for `RegistryClient`) give an offline fake registry. `tests/integration/real-install.test.ts` runs a real `install()` end-to-end: single-package, multi-package, lockfile + tarball-cache reuse (3 tests). ADR-0021 acceptance for chalk/express and `tools/integration-fixtures/refresh.ts` stay on M11 (chalk/express are not zero-dep).

### A-028 [R] Parity-runner covers little
**Status:** RESOLVED (2026-05-25). Runner fix: setup files now mount alongside the entry in both environments (Node — copy into `entryDir`; rifty — `/work/<rel>` next to `/work/main.{js,mjs}`). +2 cases (`modules/cjs-cycle`, `modules/tla`); 21 total. `pnpm check:parity-coverage` enforces a floor ≥ 1 per represented module and warns at < 5 (ADR-0022 target).

### A-029 [R] No E2E for M5-M10
**Status:** RESOLVED (2026-05-25). `pnpm check:e2e-coverage` lists M0..M10 specs, reports missing ones as a warning (M3/M5/M6/M7/M8/M9/M10), wired into CI lint-and-typecheck. Non-failing per ADR-0022 §Consequences; backfill — M11.

### A-030 [R] Lockfile written but not read
**Status:** RESOLVED (2026-05-26). ADR-0023 implemented end-to-end. `packages/npm-client/src/installer.ts` reads `<cwd>/package-lock.json` first; when every top-level dep's pin still satisfies the requested range (after applying user + baked-in overrides — see ADR-0023 §"Implementation notes (2026-05-26) — overrides re-applied on fast path"), replays the closed subgraph through `VfsTarballCache` at `/.rifty/tarball-cache/<sha-prefix>/<name>-<version>.tgz`. Integrity-verified cache hits skip the network entirely. Coverage: 4 conformance tests (`tests/conformance/npm/lockfile-reuse.test.ts`) + integration roundtrip (`tests/integration/real-install.test.ts:81` — second install with the same `package.json` issues 0 packument + 0 tarball calls against the vendored fake registry) + 3 unit tests for the overrides-on-fast-path divergence (`installer-lockfile.test.ts`).

### A-031 [R] Linker: version conflict → silent skip
**Status:** RESOLVED (loud-throw) — `packages/npm-client/src/installer.ts` now throws `Object.assign(new Error(...), { code: 'EVERSIONCONFLICT', packageName, firstVersion, secondVersion })`. The `conflicts: []` field is kept for compatibility (always empty). Test: `installer.test.ts` builds a real gz-tar fake registry with two packages requiring different versions of a third, then asserts rejection with the correct shape. **Nested install (M12 decision, 2026-05-26):** full nested layout (`node_modules/<a>/node_modules/<b>/...`) deferred to M12 (see ADR-0023 top-of-file). Until then, flat-tree linker + hard `EVERSIONCONFLICT`. Requires a linker schema rewrite + lockfile-shape extension — both fit the M12 toolchain pass alongside the `@riftydev/net` cross-realm streaming rewrite.

### A-032 [R] Q4' (prod npm-registry proxy) not registered
**Status:** RESOLVED — filed `Q-2026-05-24-007` in `OPEN_QUESTIONS.md`. Provisional decision: Vercel Edge Function (fallback — Cloudflare Worker). Pre-implementation; no marker required (`todo-report.mjs` recognizes this correctly).

### A-033 [R] `compat-matrix` empty for fs/streams/http
**Status:** **Manually triggered before each milestone DoD cycle** (2026-05-26 decision, documented in `CLAUDE.md` §"Definition of done"). `pnpm compat:generate` is not invoked per PR (keeps CI fast + avoids noisy churn) — the milestone closer runs it once and commits the diff. Regeneration for the M10 → M11 transition stays on the milestone closer's plate.

### A-034 [R] Zombie dependency `es-module-lexer`
**Status:** RESOLVED — removed from `packages/runtime-js/package.json` `dependencies`. Lockfile regenerated; the package remains in the tree only as a transitive dependency of Vite (that's fine). No imports in `packages/` (`rg "es-module-lexer" packages/` — 0 hits in source).

### A-035 [R] `package.json` `imports` field (`#dep`) not implemented
**Status:** RESOLVED — `packages/runtime-js/src/module-loader/resolver.ts` now handles `#`-specifiers (walk up to the nearest `package.json` with an `imports` field, apply condition logic, support wildcards). 5 conformance cases in `tests/conformance/modules/imports-field.test.ts`.

### A-036 [R] `RiftyTerminal.setBusy()` — dead API
**Status:** RESOLVED — removed the method from `packages/terminal/src/terminal.ts`. The internal `busy` state remains (managed by `handleData`). There were no external consumers.

### A-037 [R] `ChildProcess.stdin` — silent no-op
**Status:** RESOLVED — `packages/runtime-js/src/builtins/child_process.ts` now has `stdin = { write, end }`, both throwing `NotImplementedError('child.stdin.{write,end}', '...see ADR 0011')`. Type updated (`{ write(chunk): never; end(): never }`). 2 tests in `tests/conformance/builtins/child_process.test.ts`.

### A-038 [R] Worker crash recovery: pending evals hang
**Status:** RESOLVED — `packages/runtime-js/src/host.ts` `worker.addEventListener('error', …)`: reject all pending entries with `Error{ code: 'WORKER_CRASHED' }`, clear pending, emit `{ type: 'exit', reason: 'error' }`, terminate the worker. No auto-restart (the caller's recourse is `reset()`).

### A-039 [R] Files over the ~300-line limit
**Status:** PARTIAL — enforcement RESOLVED (2026-05-24, second sub-session): `tools/checks/file-budget.mjs` (biome v1.9 has no such rule), threshold 300, EXCEPTIONS set of 8 files (4 from the brief + 4 found during rollout: `buffer.ts`, `crypto.ts`, `fs.ts`, `esm-ast.ts`). Wired into `package.json` (`pnpm check:budget`) and `.github/workflows/ci.yml` `lint-and-typecheck` job. Exact line counts documented in ADR-0024. **WASI decomposition** (`wasi.ts` → `syscalls/{fd,path,proc}.ts`) stays in M11 (needs more WASI tests).

### A-040 [R] Source-of-truth drift
**Status:** RESOLVED. `README.md` — `Active milestone: M10 (Real Tooling)`, port `5273`. `apps/playground/index.html` — xterm CSS `<link>` href rewritten from `/node_modules/@xterm/xterm/css/xterm.css` to `/@xterm/xterm/css/xterm.css` (Vite resolves it in both modes).

---

## Metrics after the session (updated 2026-05-24, after the second sub-session)

- **Dependency cycles:** 0 ✅ (was 1)
- **TODO(ADR) markers (in code):** 5 (Q-002 × 1, Q-003 × 1, Q-004 × 1, Q-005 × 2)
- **OPEN_QUESTIONS active:** 4 (Q-002, Q-003, Q-004, Q-2026-05-24-007 prod proxy)
- **OPEN_QUESTIONS promoted:** 2 (Q-001 → ADR 0009, Q-005 → ADR 0018)
- **OPEN_QUESTIONS rejected:** 1 (Q-006 → ADR 0010)
- **ADRs:** 24 (0001-0024). Implemented in this work: 0010 (https loud-throw), 0016 (SW from TS), 0018 (subpath exports — retroactive). Partial: 0020 phase 1, 0022 (3 of 5 cases), 0024 (enforcement). The rest deferred to M11/M12.
- **Conformance + integration tests:** **255 pass** (was 222 → 250 → 255). Delta this sub-session: +5 (`Vfs.openReadable`).
- **Parity cases:** **19** (was 15 → 16 → 19). Delta this sub-session: +3 (`stream/backpressure`, `stream/pipeline-multi`, `http/parse-url`).
- **Typecheck (16 projects):** clean
- **Lint (biome):** clean (1 pre-existing warning — `perf_hooks.ts`); generated `sw.js` in biome ignore
- **`check:deps`:** clean
- **`check:isolation`:** clean
- **`check:budget`:** clean (8 documented exceptions)
- **`todo:adr`:** exit 0

## What remains open

- **A-033** — `compat:generate` not yet run; M11 as part of the DoD cycle.

- **A-041 [R] `RiftyTerminal.handleInput` public "for testing"** (2026-05-26): `packages/terminal/src/terminal.ts:109` — `handleInput` is currently `public` with a TSDoc note that production callers must not call it. Task: make it `private` + add an `onHandleInput?: (e: KeyEvent) => void` callback to `RiftyTerminalOptions` for test observability. **Status: deferred** — the existing `packages/terminal/src/terminal.test.ts` is tightly coupled to direct `await term.handleInput(...)` calls (~30 tests, synced via the returned Promise). Moving to a callback requires fully rewriting test orchestration (await on callback emit instead of method return), which is out of scope for the current "don't break the test suite" task. Return to it in a separate session when the test rewrite is the main focus.
- **Implementation deferred items for M11:** A-001, A-002, A-003, A-005, A-006, A-007, A-008, A-014, A-017 (the full plugin spec in ADR-0016 is already implemented, but the broader migration to "SW only as a bundled artifact across all environments" is M11), A-019, A-020 (phase 2: OPFS + fs-streams rewrite), A-021, A-022 (full coverage), A-023, A-026, A-027 (chalk/express follow-up — the zero-dep slice already landed), A-030, A-031 (nested install), A-039 (WASI split). (A-004 closed 2026-05-26 — bootstrap wiring + persistence e2e in place.)
- **Implementation deferred items for M12 (after M11):** A-022/A-024/A-025 (streaming HTTP + cross-realm WS rewrite).
- **Q-2026-05-24-007** — pre-implementation, awaiting the first prod deploy.
- **Paired cycle/TLA parity cases (A-028)** — blocked on the runner fix (mount setup.files alongside entry).
