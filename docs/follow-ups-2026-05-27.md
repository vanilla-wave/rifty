# Follow-ups — architecture audit 2026-05-26

Open items deferred from the 30-commit fix session on branch `kernel-syncrpc-protocol-versioning`. Closed items are listed at the bottom for reference. Ordered roughly by ROI within each tier.

## Tier 1 — start here next session

### 1. Live `install('express')` against the prod proxy
**Why it matters:** flat-only linker throws `EVERSIONCONFLICT` on any version overlap. Express's 50+ transitive deps may not flatten cleanly. If they don't, **M11 nested install becomes a prerequisite for M9**, not a follow-on (per ADR-0023 nesting is M11). This single experimental run decides scheduling.

**Action:** `pnpm dev` → playground → run a fixture that does `installer.install('express', '^4', {…})` against the live Vercel Edge proxy (ADR-0028). Capture the resolution log. If conflict fires, file the deps that triggered it. If it succeeds, M9 stays on its current path.

**Refs:** npm-client audit P2-6, ADR-0023, ADR-0028, `installer.ts` (now unified via `ResolutionSource` per commit `e030591`).

### 2. Unify `Vfs` / `FsSync` readdir shape on `VfsDirent[]` and add `utimes` to async `Vfs`
**Why it matters:** `Vfs.readdir → VfsDirent[]` vs `FsSync.readdirSync → string[]` forces every adapter that bridges between them to do N+1 `statSync` per child (e.g. `apps/playground/src/adapters/sync-mirror-vfs.ts:33`). The bridge exists *because* the interfaces don't match.

**Action:**
- Change `FsSync.readdirSync` to return `readonly VfsDirent[]`.
- Add `utimes(path, atime, mtime)` to async `Vfs`.
- Update every caller (grep both methods workspace-wide). Most callers want dirent shape anyway — they were re-statting to recover it.
- New ADR (IRREVERSIBLE — public interface change).
- One commit.

**Refs:** vfs audit F3, ADR-0029.

### 3. Kernel stdio abstraction: hide raw `MessagePort` triple behind a sealed interface
**Why it matters:** `ProcessHandle.ports: WorkerStdioPorts` leaks to every caller. `wireWorkerStdio` boilerplate (start/onmessage/close) is repeated in `runtime-js/builtins/child_process-worker.ts:90-128` and `worker_threads.ts:85-91`. Same shape will be needed for the M8 dispatch into `WasiProcessHandle`.

**Action:**
- Expose `handle.stdout(): ReadableStream<Uint8Array>` (or push-callback) on `WorkerProcessHandle`. Same for stdin/stderr.
- Existing `ports` field can stay for an interim release with a deprecation note.
- Adapter inside `@rifty/kernel` uses `@rifty/io`'s `Readable`/`Writable` to wrap the ports — `io` is below kernel, so it's top-down legal.

**Refs:** kernel audit P1-1.

---

## Tier 2 — pickable when convenient

### 4. `npm-client` test fixtures share a tar builder
**Today:** four sibling test files each ship their own ~50-line `buildHeader + makePackageTarball` (`installer.test.ts:11-66`, `installer-lockfile.test.ts:15-60`, `installer-peer-optional.test.ts:14-56`, `installer-pipeline.test.ts:22-69`); a fifth copy lives in `tests/integration/fixtures/local-registry.ts`.

**Action:** factor into `packages/npm-client/src/_test-fixtures/tar-builder.ts` (test-only export) and import. Any tar-format fix becomes a one-file change.

**Refs:** npm-client audit P1-5.

### 5. `runtime-js`: explicit installer pattern instead of module-load side-effects
**Today:** `runtime-js/builtins/child_process.ts:44-48` installs the execSync handler at module-load (side-effect). `net/register-builtins.ts` is the symmetric case — works today but every new app bootstrap must remember the side-effect import.

**Action:** replace with explicit `installCoreBuiltins(opts)` calls in the worker boot. ADR-0039 already moved the kernel parts; this is the next half. Less fragile when M11 multi-realm lands.

**Refs:** runtime-js audit P1-5, kernel audit P0-2 follow-on.

### 6. SW `OwnerResolver` + `ReadyClientsRegistry` swap together (A-026 prep)
**Today:** `PreviewOwnerResolver` is cleanly extracted, but `ReadyClientsRegistry` (the handshake) lives in `preview-bridge.ts` and assumes `event.source as Client` (window source). When M11's `WorkerOwnerResolver` arrives, the readiness model has to follow — workers have different `pagehide`/`controllerchange` lifecycle.

**Action:** define `PreviewOwnerBinding` interface that includes both `resolveOwner` and `subscribeReadiness`. M11 swaps a coherent strategy rather than just a lookup.

**Refs:** service-worker audit F3, commit `1bc2f91` (PreviewOwnerResolver extraction).

### 7. `playground/src/adapters/` directory hygiene
**Today:** 7 files under `adapters/`. Only 2 actually do core↔Solid conversion (`useRuntime`, `useShellSession`). The other 5 (`devMode`, `realVite`, `preview-bridge-wiring`, `registry-fetch`, `sync-mirror-vfs`, `esbuild-shim`, `hmr-bridge`) are plain glue with no Solid story.

**Action:** rename to `apps/playground/src/glue/` for the plain-glue ones, keep `adapters/` for the actual reactive bridges. Pure organisation; no behavior change.

**Refs:** playground audit verdict.

### 8. `realVite.ts` extract phase helpers (A-026 prep)
**Today:** `startRealVite` is one 277-LOC function doing six discrete phases. When ADR-0025's "dev-server realm = main thread" forks for M11's worker realm, the change touches the whole function.

**Action:** extract `installVite(root, log)`, `bootViteModuleLoader(root)`, `wireHmr({port, server})` as named helpers. Same logic, four 60-LOC functions instead of one 200-LOC function.

**Refs:** playground audit finding 4.

### 9. `useRuntime` does no Solid conversion — demote
**Today:** `useRuntime.ts:43-69` returns an ad-hoc object literal that re-implements `RuntimeController`'s surface. The only Solid touch is `onCleanup`. Either make it a real reactive projection or move it out of `adapters/`.

**Action:** either (a) project runtime events into `createStore`/`createSignal` so components observe `lastResult`/`isReady`/`exitReason` reactively, or (b) demote to `apps/playground/src/runtime-glue.ts`. Pick whichever solves an actual UI need.

**Refs:** playground audit finding 2.

### 10. WASI cookie semantics + `d_type` filled
**Today:** ADR-resilient cookie now honored (commit `d525e78`), but `d_type` always returns `FILETYPE_UNKNOWN` (`fd.ts:282-285`). Guests like esbuild re-stat every dirent to distinguish files from subdirs.

**Action:** add `readdirWithTypesSync(path): Array<{name, type}>` to `Vfs`/`FsSync` (overlaps with item 2 above), or inline a `statSync` loop in `fd_readdir`. Quadratic-feeling I/O on real `node_modules` traversal goes away.

**Refs:** runtime-wasi audit F3.

---

## Tier 3 — deepening opportunities (not blockers)

### 11. `npm-client.install()` factory replaces opt-injected fields
**Today:** `InstallOptions` carries the whole DI surface; every caller (`apps/playground/.../realVite.ts:147`, `tests/integration/real-install.test.ts`, etc.) constructs `RegistryClient` + caches itself.

**Action:** offer `createInstaller({ fetch?, registryUrl?, vfs })` returning `{ install, prune, ... }` so the caller burden is one factory call.

**Refs:** npm-client audit second P0 (the deep-entry concern).

### 12. `runtime-js` loader: `node:` stripping consolidated
**Today:** `module-loader/loader.ts` does `id.startsWith('node:')` in three places (lines 50, 74, 100), each repeating the same conditional flow.

**Action:** route every builtin lookup through one helper `loadBuiltinOrThrow(specifier, originalSpec, fromFile)`.

**Refs:** runtime-js audit P2-6.

### 13. `runtime-js` `worker_threads.startSameRealm` semantic gap
**Today:** the same-realm fallback runs the worker script in the parent's realm with no `globalThis` isolation, no separate module loader. Works for fan-out concurrency, breaks if any `require()` runs inside. One-shot warn is in place; the gap is undocumented in compat matrix.

**Action:** mark it as a documented compat limitation in `docs/compat/modules.md` (or wherever worker_threads is tracked).

**Refs:** runtime-js audit P2-8.

### 14. `io/streams/readable.ts` is approaching 549 LOC and bundles many concerns
**Today:** state shape + `chunkSize`/`sliceBuffer`/`takeAll` helpers + the class + `Symbol.asyncIterator` + `Readable.from` all in one file. Not a hard-rule violation (ADR-0033 removed the cap), but the next round of tweaks (encoding, `wrap`, `unpipe` follow-ups) will push past the comfort threshold.

**Action:** extract `_readableState` + slice helpers into `streams/readable-state.ts`; move `[Symbol.asyncIterator]` and `from` into `streams/readable-iter.ts`. The flow state machine stays in one cohesive file.

**Refs:** io audit P2 streams-readable.

### 15. `shell` registers `npm`/`node` commands from the playground
**Today:** `shell.ts:100` exposes `registerCommand` and advertises that the playground plugs in `npm`/`node`. `rg registerCommand apps/playground packages/npm-client` returns zero hits. Typing `npm install` at the prompt hits `cmd: command not found` exit 127.

**Action:** add a `useNpmCommand(shell, npmClient)` adapter in playground (or a `packages/shell-npm-bridge`) that calls `shell.registerCommand('npm', ...)`. Closes the M9 prompt-install wiring gap.

**Refs:** shell audit F1.

### 16. `terminal`: raw-mode line discipline
**Today:** line-mode (history, prompt, busy gate, local echo, `^C`) is fused into `RiftyTerminal`. No raw-mode path. The day a TUI (`vim`, `top`, `ncurses` test) needs raw bytes, the class needs a `mode: 'cooked' | 'raw'` axis.

**Action:** extract `LineDiscipline` (state owner) consumed by `RiftyTerminal` (xterm-host + I/O surface). Raw mode becomes a different discipline.

**Refs:** terminal audit P2 first finding.

### 17. `terminal.stdin: ReadableStream<string>` alongside the callback
**Today:** `onInput(line)` / `onSignal('SIGINT')` callbacks diverge from kernel/runtime-js stream-shape elsewhere.

**Action:** expose `terminal.stdin: ReadableStream<string>` / `stdout: WritableStream` so a `processHandle` connects directly; keep the callback for simple uses.

**Refs:** terminal audit P2 second finding.

### 18. `PreviewPanel` iframe reload via `?v=N` is the wrong abstraction
**Today:** local `version` signal exists only to bust the iframe `src`. Competes with ADR-0017's HMR-client `location.reload()`.

**Action:** drop `version`, use `ref={frame}` + `frame.contentWindow?.location.reload()`. Smaller surface; HMR becomes the single source of truth for iframe refresh.

**Refs:** playground audit finding 6.

### 19. HMR bridge asymmetry between `devMode` and `realVite`
**Today:** real-vite mode broadcasts HMR through the bridge; dev mode uses its own internal HMR client. Two paths, no flag.

**Action:** either wire both through one bridge, or document the asymmetry in `hmr-bridge.ts` so a reader doesn't assume parity.

**Refs:** playground audit finding 5.

### 20. `NotImplementedError`: single source vs deliberate fork
**Today:** `@rifty/io` and `@rifty/vfs` each define their own `NotImplementedError`. `instanceof` does not unify. Mid-layer code that catches one misses the other.

**Action:** either (a) lift into a tiny zero-dep `@rifty/errors`, or (b) accept the fork and document the catch contract per layer. Decide based on actual cross-layer catch sites — probably zero, in which case (b) is cheaper.

**Refs:** vfs audit F7.

### 21. `installer.ts` lockfile fast-path: partial install on malformed entry
**Today:** the unified pipeline (commit `e030591`) preserved a latent behavior: a lockfile entry missing `resolved`/`integrity` causes the walk to stop *silently* with a partial pinned set, not error. In a valid lockfile this never fires; a hand-crafted one would.

**Action:** decide — escalate to a hard throw, or fall through to live-resolve. Add a test for the chosen behavior.

**Refs:** subagent-12 commit report, audit didn't catch.

### 22. `shell` pipes / redirect via `@rifty/io` streams (deferred to M12)
**Today:** `runSegment` returns one buffered `RunResult`; pipes throw `NotImplementedError` tagged "M12"; redirect via `writeFileSync` buffers entire stdout in memory.

**Action:** model a segment as `{ cmd, args, stdin, stdout, stderr }` over `@rifty/io` `Readable`/`Writable`. Pipe = head-to-tail wiring; redirect = vfs-file `Writable` sink. Currently M12 in `TASKS.md`.

**Refs:** shell audit F3/F4, M9/M10 may hit it earlier than M12 if `npm install 2>&1 | tee log` is needed.

### 23. `runtime-wasi`: split `Wasi` constructor (test ergonomics)
**Today:** `Wasi` bundles imports assembly + memory binding + fd seeding + lifecycle into one object. Tests build fixtures (`fd-test-fixture.ts`, `path-test-fixture.ts`) that recreate wiring instead of using `Wasi` directly.

**Action:** split `WasiContext` (mutable state — fds, exit, stdio) from `Wasi` (imports table + lifecycle). Promote `WasiCtx` to a public type. Helps M8 ProcessHandle adapter extend syscall sets without rewriting `start()`.

**Refs:** runtime-wasi audit F4.

### 24. `runtime-wasi` preopens: explicit `cwd` and ordering
**Today:** `wasi.ts:46-56` walks `Object.keys(preopens)` insertion order to allocate fd 3, 4, … The "first preopen wins fd 3" semantic leaks into how callers build the map. No explicit `cwd`.

**Action:** surface `cwd?: string` option, or require ordered array `[{guestPath, hostPath}]`. Document which preopen is the relative-path-resolution default. M8 (esbuild expects `/workspace` or `.`) needs this.

**Refs:** runtime-wasi audit F5.

---

## Done in this session (for reference)

30 commits closed all P0s from the audit + the in-scope P1/P2 quick wins. Highlights:

- ADRs 0035–0040 added (builtin registry → io, preview-protocol, unified SyncVfs, WasiProcessHandle, lift-Node-from-kernel, SW frame+routing split).
- Reverse import `net → runtime-js` removed.
- Two parallel SyncVfs hierarchies unified.
- `OpfsFsSync` now implements all 7 FsSync methods.
- `WasiProcessHandle` adapter unblocks M8.
- 3 io stream P0s fixed with parity coverage (asyncIterator cleanup, pipe/unpipe symmetry, `Readable.from` mode detection).
- 3 silent-stub hard-rule violations closed.
- `installer.ts` unified via `ResolutionSource` (lockfile/registry).
- `BuiltinFactory<T>` generic drops 37 `as unknown as` casts.
- M7 e2e through SW now Playwright-covered.
- App.tsx mode-state machine extracted (315 → 259 LOC).
- 10+ smaller P1/P2 cleanups.

Tests: 732 passing (was 698 at session start). All gates green: typecheck, lint, check:deps (madge), test:run. Branch `kernel-syncrpc-protocol-versioning`, not pushed.
