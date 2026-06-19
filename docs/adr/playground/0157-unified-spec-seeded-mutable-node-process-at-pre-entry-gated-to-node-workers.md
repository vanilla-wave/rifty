# ADR 0157: Unified spec-seeded mutable Node process at pre-entry gated to Node workers

Status: Accepted (2026-06-20)
Date: 2026-06

> TL;DR: ONE `NodeProcess` class — spec-seeded AND mutable — installed once at the kernel pre-entry seam, gated to Node workers (rich = +`Buffer`+nextTick-Promise-patch; WASI = skip). Kills the post-spawn `globalThis.process` swap (`installRuntimeGlobals`→`installProcessGlobals`) so argv/cwd/stdin are faithful **by construction**, not by re-copy.

## Context

ADR-0039 moved the Node `process` out of the kernel into runtime-js. Two divergent shims resulted:

- `WorkerNodeProcessShim` (`ipc/install-process.ts`): spec-seeded (pid/ppid/argv/env/cwd + 4 stdio MessagePorts + ADR-0045 fork-IPC) but **immutable** — no `chdir`/`nextTick`/`hrtime`/`uptime`/`exitCode`. Installed by the kernel pre-entry hook for every spawned child.
- `RiftyProcess` (`builtins/process.ts`): the rich **mutable** surface (chdir/nextTick/hrtime/uptime/exitCode + Promise.then nextTick-ordering patch) but **default** argv=`['rifty','repl']`, cwd=`/workspace`, stdin = bare EventEmitter, stdout/stderr→`console.*`. Singleton installed by `installProcessGlobals()` (the REPL worker) and re-used by the playground owner/dev-server/node-serve realms via `installRuntimeGlobals()`.

`node-entry-bootstrap.ts` (RIFTY_NODE_SERVE branch) called `installRuntimeGlobals()` (`worker-runtime-globals.ts`) → `installProcessGlobals()` which **swapped** `globalThis.process` from the seeded shim to the default `riftyProcess`, then re-copied only stdout/stderr/env/IPC back. argv/cwd/stdin were dropped silently. Worse: the bootstrap read `const proc = globalThis.process` BEFORE the swap, so `installLoudStdin(proc)` and `proc.cwd()` operated on the **orphaned** old shim while user code (loaded by the module loader) saw the swapped default `riftyProcess` — split-brain: wrong argv (`['rifty','repl']`), wrong `process.cwd()` (`/workspace`), and a stdin guard installed on the wrong object. Root cause of the argv/cwd/stdin bug class.

Two further latent gaps: kernel children get **no** `nextTick`/`hrtime`/`chdir` and the `.bin`/`execSync` else-branch gets no `Buffer` and no nextTick-ordering patch (a `.bin` tool using `Buffer` → ReferenceError; `process.nextTick` → TypeError). And a known prod hazard (`backlog: runtime-js/worker-entry-process-globals-side-effect`): the REPL `worker-entry.ts` top-level `installProcessGlobals()` can leak into the owner chunk and re-swap an empty-env process during an `await`, defended against by an env re-assert dance.

ADR-0154 §5 already fixed observable behavior loudly (stdin guard) but on the orphaned object; this ADR fixes it **by construction**.

## Decision

**1. One `NodeProcess extends EventEmitter`** (in `builtins/process.ts`, where cwd-cell/nextTick/chdir/hrtime already live; `ipc/install-process.ts` imports it — one-way ipc→builtins, no cycle). Constructor `new NodeProcess(spec?)`:
- spec present (kernel child) → seed pid/ppid/argv + env (COPY, mutable, no leak into the published Readonly spec); stdout/stderr = `makeStdioWriter(spec.stdio.*)`; stdin = `makeStdinReader(spec.stdio.stdin)` (MessagePort); fork-IPC `send`/`disconnect`/`on('message')` from `spec.stdio.ipc` + pre-listener backlog.
- spec absent (REPL fallback) → pid=1/ppid=0, argv=`['rifty','repl']`, stdout/stderr→`console.*`, stdin = host-bridge reader (`writeProcessStdin` pushes to it), no fork-IPC.
- ALWAYS mutable: `chdir` (VFS-validated), `cwd()`, `hrtime`+`bigint`, `uptime`, `nextTick`, `exitCode`, `exit()` (sets exitCode then throws `RIFTY_PROCESS_EXIT`). `instanceof EventEmitter` holds (same `@riftydev/io` base).

`cwd()` reads a **realm-local module cell** (`currentCwd`), seeded from `spec.cwd` at construction, written by `chdir`/`setProcessCwd`, read by `getProcessCwd()` — so `fs`/`path`/conformance keep their one source of truth. `builtins/process` keeps its public exports (`riftyProcess` no-spec singleton, `installProcessGlobals`, `setProcessCwd`, `getProcessCwd`, `writeProcessStdin`) as thin delegates → console/util/index/fs/path importers unchanged.

**2. Gated rich install at the pre-entry seam.** The pre-entry hook (`install-process.ts` `preEntryInstaller`, called from `kernel-worker-entry.ts`) builds `new NodeProcess(spec)` once. Gate: `isNode = spec.env.__RIFTY_WASI_WASM_URL === undefined` (WASI is the only non-Node consumer of this seam and self-identifies; all Node child kinds — .bin/execSync/node-serve/dev-server/owner — lack the key). `isNode` → also run `patchPromiseForNextTick()` (nextTick wins over Promise.then) + set `globalThis.Buffer`. WASI → skip both (no over-implementation of Node where it shouldn't be). Timers + keepalive + unhandledrejection trap stay universal at `kernel-worker-entry.ts` module top-level (do NOT gate — moving them risks the awaitDrain host-setTimeout capture). Rich install stays in runtime-js; kernel stays Node-API-agnostic (ADR-0039).

**3. No swap.** `node-entry-bootstrap.ts` drops the `installRuntimeGlobals()` call; `proc = globalThis.process` is the seeded rich process throughout → orphan gone, argv/cwd/stdin/nextTick/Buffer faithful by construction; `postListening` uses `proc.send`. `installRuntimeGlobals()` (`worker-runtime-globals.ts`) degenerates to a thin IPC-handle accessor (reads `send`/`on('message')` off the already-rich `globalThis.process`; no `installProcessGlobals`/Buffer/timers swap) — still called by dev-server-child + real-vite for the `{send,onMessage}` handle. `setProcessCwd(root)` retained where the realm overrides cwd (owner project-root, dev-server). Because the pre-entry hook runs AFTER worker-chunk module-eval, removing the in-entry swap is what makes the owner robust: the pre-entry spec process is the canonical one user code sees, regardless of any stray top-level install in a co-bundled chunk. `installProcessGlobals()` is ALSO made **idempotent** (skip if `globalThis.process instanceof NodeProcess`) as defense-in-depth; this MITIGATES (not fully closes) `backlog: runtime-js/worker-entry-process-globals-side-effect` — the chunk-graph isolation + the env-reassert removal stay tracked there, and the owner/dev-server defensive `readKernelProcessSpec()` env reads are RETAINED.

**4. stdin contract.** Forward target (faithful, backlog): pump owner `ctx.stdin` → `handle.stdin()` → child stdin MessagePort → `makeStdinReader` (both ends already exist; only the pump is missing — `backlog: kernel/worker-per-process-residuals` + `terminal/raw-stdin-deferred-items`). Interim (this ADR, extends ADR-0154 §5): `installLoudStdin` patches the REAL seeded stdin EventEmitter **in place** so every consume method throws `NotImplementedError` — listener-add for the `'data'` event (on/once/addListener/prependListener/prependOnceListener), `read`/`pipe`/`[Symbol.asyncIterator]`, and the silent-success surfaces `resume`/`pause`/`setEncoding`/`setRawMode` (absorbs the former missed-method gap). `isTTY`/`fd`/`'end'` stay passive. Gated to node-serve scope (RIFTY_NODE_SERVE), matching ADR-0154 §5.

## Consequences

- (+) argv/cwd/stdin/nextTick/Buffer faithful by construction for every Node worker; the swap/re-copy/orphan class of bugs is structurally impossible.
- (+) `.bin`/`execSync` children gain `Buffer` + nextTick-ordering (closes a latent fidelity gap) — a behavior CHANGE, guarded by parity/regression tests.
- (+) Mitigates `backlog: runtime-js/worker-entry-process-globals-side-effect` (no in-entry swap + idempotent install); the owner/dev-server defensive env reads are retained (chunk-graph isolation still tracked).
- (+) One process class, no per-realm swap-then-re-copy; fork-IPC preserved from construction (no capture-before-swap).
- (−) IRREVERSIBLE: changes the shared pre-entry seam behavior + merges two public-subpath shims (`./install-process`, `./builtins/process`). Gate reads an existing env key (`__RIFTY_WASI_WASM_URL`) — NO new kernel public API, no `WorkerSpawnSpec` widening.
- (−) `patchPromiseForNextTick` (global, irreversible per realm) now runs in `.bin`/execSync realms too — same blast radius as the owner already had; must run inside the install before any user/library import. NEGATIVE guard: a WASI/non-Node realm leaves `Promise.prototype.then` native.
- Builds on ADR-0039 (process in runtime-js), ADR-0045 (fork-IPC), ADR-0150 (supervised child), ADR-0152 (drain/serve). Relationship to ADR-0154: §2 bootstrap-owns-drain is unchanged; ADR-0154 §1 (reuse claim) + the keepalive-comment are Corrected in place (not superseded). Follow-up: faithful stdin forward pump.
