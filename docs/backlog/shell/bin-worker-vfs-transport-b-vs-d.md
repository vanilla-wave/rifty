---
area: shell
status: parked
title: Bin/shell worker VFS transport — B (SAB fs-proxy to PAGE) vs D (single owner-worker)
created: 2026-06-14
why: ADR-0137 bin execution ENOENTs end-to-end — the spawned bin worker's syncMirror() is its own empty in-worker store; the shell's node_modules live in PAGE memory, not a shared OPFS realm, so node-modules-bin-execution's "read the install realm's OPFS VFS" next-step rests on a false premise (ADR-0135: no page↔worker shared OPFS). Forks B vs D.
user_story: As a developer at the rifty prompt, I `npm install cowsay` then run `cowsay hi` and want the CLI to run; today the bin worker can't see the node_modules the shell installed (different realm), so the shim ENOENTs and nothing runs.
sources: [ADR-0137, ADR-0135, ADR-0080, ADR-0072, shell/node-modules-bin-execution, runtime-js/execsync-node-entry-loader]
code: [apps/playground/src/App.tsx, apps/playground/src/glue/bin-executor.ts, apps/playground/src/workers/node-entry-bootstrap.ts, packages/runtime-js/src/builtins/node-entry.ts, packages/runtime-js/src/ipc/recursive-runner.ts]
---

## DECIDED → D (ADR-0143, 2026-06-14)

Fork settled: **D (owner-worker)**. Decision + phasing live in `docs/adr/shell/0143-bin-shell-execution-model-owner-worker-vs-sab-fs-proxy.md`. All premises below re-verified 2026-06-14 (file:line drift ≤2; the "Entry points" map holds). Three refinements from the verification pass, folded into the ADR:

1. **D is two stacked irreversibles.** D's "reuse the real-vite owner" rests on a worker with no process lifecycle (ADR-0077 keep-alive hack, per-preview, killed on mode-leave; the kernel lifetime fix was rejected as IRREVERSIBLE+broad). D's real **P1 gate** is a kernel server-process model (ADR-0077 follow-up), not the transport itself.
2. **B was framed as more novel than it is** — it extends the already-shipped ADR-0087 worker→PAGE SAB `execSync` responder with `fs.read` handlers (ADR-0080's anti-SAB lean is scoped to the file *browser*). Still: B-on-PAGE janks, and the worker→PAGE direction is throwaway under D. B stays a deletable stepping stone, not the destination.
3. **The `execSync` entry-kind flip is NOT a safe standalone increment** (this doc's §Recommendation overstated it). Flipping `execSync` to `kind:'url'` regresses the passing COI e2e `tests/e2e/execsync-sab.spec.ts`: today it works because `kind:'source'` carries the script bytes in the spec (the child never reads a file); `kind:'url'` makes the child read from its own empty store → ENOENT. The flip lands WITH D's owner-worker. See `docs/backlog/runtime-js/execsync-node-entry-loader.md`.

The analysis below is the pre-ADR record; superseding analysis lives in ADR-0143.

## Actors (the confusion lives here)

- **PAGE** (main thread): terminal/shell, editor, explorer. Own in-memory `syncMirror()`. `npm install` writes node_modules HERE.
- **bin worker**: spawned per bin command (`App.tsx`), own EMPTY in-memory store, runs the shim via `runNodeEntry`.
- **real-vite worker**: separate preview feature — own store, own install. Reference "owner" pattern, NOT in the shell flow. **Memory-backed TODAY** (common misread: it is NOT OPFS-backed). Verified: no `initBackend`/`installOpfsFs`/`OpfsFsSync` anywhere in `apps/playground/src/workers`; the kernel-worker pre-entry hook installs only the process shim; `flushSyncMirror` is a no-op on `MemoryFsSync`. ADR-0135 INTENDS worker-owned OPFS but it is not wired on the playground kernel-worker path. Net: **three memory stores** (PAGE + preview worker + bin worker), no single source of truth.

## Current shell bin flow (broken)

1. `npm install cowsay` → node_modules land in PAGE memory.
2. `cowsay hi` → shell on PAGE resolves name → finds `/workspace/node_modules/.bin/cowsay` (reads PAGE store). ✓
3. shell → `execBin` → spawns bin worker, passes shim path (string) + argv.
4. bin worker pre-entry hook installs only the process shim; bootstrap calls `runNodeEntry({ vfs: syncMirror(), entryPath: shimPath, bin: true })`.
5. `syncMirror()` here = the worker's OWN empty store → `readFileBytesSync(shimPath)` → ENOENT. ✗

Root: the path travels as a string, the files do not. The worker can't see node_modules sitting in PAGE memory. Mechanism (`runNodeEntry` + loader) is unit/parity-proven; the TRANSPORT is the dead link. (`node-entry-bootstrap.ts`'s own comment says a "SAB-backed sync mirror" is installed — that is the INTENDED transport, never wired; the hook installs the process shim only.)

## Why the existing backlog next-step is wrong

`shell/node-modules-bin-execution` (and `runtime-js/execsync-node-entry-loader`) propose: call `initBackend()` (OPFS) in `node-entry-bootstrap.ts` / share the install realm's VFS — premised on node_modules living in a worker/OPFS realm the bin worker can also open.

False for the SHELL flow:
- the shell's `npm install` is the PAGE-side ad-hoc command (ADR-0135: it stamps under slug `''`, never reused by a worker boot) → node_modules are in PAGE memory;
- there is no shared OPFS — ADR-0135 settled that a page↔worker shared-OPFS warm-up is impossible (and the playground workers are memory-backed anyway);
- OPFS is not live cross-realm sharing regardless: `OpfsFsSync` is a per-realm in-memory snapshot preloaded at init + async write-through (ADR-0072), so a second worker opening OPFS sees a snapshot, not a coherent live tree.

So that next-step cannot fix the shell flow. It was written against the preview/install flow, where the WORKER owns the install — a different flow, different owner. **That conflation is the trap.** (The execSync item is a dispatch detail — move entry-kind choice into the recursive runner so a child `execSync` goes through the node-entry bootstrap too — but its child worker hits the SAME ENOENT → shared blocker.)

## Option B — files stay on PAGE; worker reads them over the wire (SAB)

node_modules stay in PAGE memory. Give the worker a way to read the PAGE store synchronously, on demand.

- Step 4: replace the empty `syncMirror()` with a SAB-backed `FsSync` proxy.
- Each `readFileBytesSync(path)` / `stat(path)` in the worker → request over a SAB ring → PAGE reads its own memory → ships bytes back → worker wakes (`Atomics.wait`).
- Worker reads the same live files the shell installed: shim loads, target + deps resolve, CLI runs, output streams. ✓
- No copy — lazy reads. PAGE = single source. Same SAB IPC as execSync (ADR-0084), plus a set of `fs.read` handlers.

**B's usability cost (load-bearing).** The PAGE becomes the RESPONDER to the worker's synchronous fs reads. No hard UI lock (responder is `Atomics.waitAsync`), BUT: a single CLI resolve = hundreds–thousands of round-trips that flood the PAGE event loop → input/render JANK during the burst; a long-running / watch process (vite HMR) reads continuously → SUSTAINED UI degradation; browsers without `waitAsync` fall back to polling → worse. ADR-0080 rejected SAB-fs for exactly this ("blocking the UI thread on reads would freeze the explorer") and recorded the lean "sync-over-OPFS-without-SAB". The NON-janky B requires the store to live in a WORKER (served worker→worker, UI never touched) — which is D-core. So "good B" converges into D; **"B on PAGE" is the janky shortcut.**

## Option D — one owner-worker holds files AND execution; PAGE becomes a viewer

Stop holding two stores.

- A persistent **workspace worker** owns node_modules + project files (one store).
- `npm install` runs in it (writes its store). `cowsay` runs in it — local sync reads, no cross-realm, no ENOENT.
- PAGE terminal → thin client (sends lines, receives output). Editor/explorer read the worker's tree via existing async ports (snapshot / nm-read), write via `vfs-write-port`.
- This is exactly how the real-vite preview worker already works — generalized into the home for the shell.

One line: B = leave files on PAGE, let the worker read them over the wire (SAB). D = move files AND execution into one owner worker, make PAGE a viewer. The backlog aimed at a third thing (shared OPFS) that does not exist.

## Recommendation

> Author's call (the source spec punted the decision).

Lean **D**. B only as a stepping stone if D can't land in one milestone.

Why D:
- **Removes the bug CLASS, doesn't bridge it.** No cross-realm fs in the hot path → no ENOENT, no read-while-PAGE-mutates race, no `fs.read` handler surface to keep coherent, no UI-jank responder.
- **Collapses store multiplicity** that is the recurring source of fs pain — one owner per workspace instead of three memory stores (PAGE + preview worker + bin worker) stitched by ports/proxies. (Same root smell as the multi-mirror `OpfsFsSync`: too many stores, no single source of truth.)
- **Converges shell with the already-working real-vite owner pattern** → one model to reason about, not two. Directly attacks the "agents don't get it first try" failure: one owner is teachable; three realms + a proxy is not.
- **Best fit for the project's #1 goal** (understand these systems): "the process owns its filesystem, the UI is a viewer over a port" IS how WebContainers/StackBlitz actually work. B teaches a niche SAB-fs-proxy trick real systems don't use.

Persistence is NOT "free" under D (a common misread corrected here): the preview worker is memory-backed TODAY, so D does not inherit an OPFS install. Persistence means deliberately wiring OPFS into the ONE owner — sound because there is a single owner (no cross-realm coherence problem), but it carries the ADR-0072 preload `O(total bytes)` start-up cost for a large node_modules tree. That cost is the same whoever owns OPFS; D at least pays it once, in one place.

Cost of D: bigger move — persistent workspace-worker lifecycle (no real process model yet; keep-alive hack at larger scope); PAGE terminal/editor/explorer become thin clients over async ports (the ports exist on the real-vite path but need generalizing); single owner realm = one JS thread, so a CPU-bound CLI stalls everything else in it → true concurrency ("shell usable while `vite` runs") ultimately needs multiple worker-processes sharing the store = the SAB sync-view mechanism of B, served worker→worker. **B and D compose at the limit** (WebContainers = owned store + SAB sync views); they are not pure alternatives.

Why NOT B as the destination: B builds a whole SAB `fs.read` transport whose DIRECTION (worker reads PAGE) is throwaway if the store moves into a worker; and B-on-PAGE janks the UI. The execSync SAB IPC plumbing is reused either way; the PAGE-side fs-proxy handlers are not.

Sequencing: D is milestone-scale (IRREVERSIBLE, multi-ADR, blast radius shell+terminal+playground+net) — a separate, deliberate pass, NOT this REVERSIBLE residual. The safe increment landable NOW under both B and D: the execSync entry-kind refactor (`runtime-js/execsync-node-entry-loader`) — internal, REVERSIBLE, unit/conformance only; its end-to-end e2e still waits on the transport. If D truly can't fit one slot: ship B to unblock the real-CLI e2e, gate the SAB fs-proxy behind a deletable seam — but note B-on-PAGE janks the UI, so even the stepping stone is better served by a worker-resident store.

## Entry points (next agent)

Start here; the trap is realm confusion, so the map is grouped by *which realm owns what*. All line refs verified 2026-06-14.

**Read order (~15 min):** this doc → `shell/node-modules-bin-execution` + `runtime-js/execsync-node-entry-loader` (the two residuals) → ADR-0135 (realm/storage constraint + the *superseded* page-OPFS sub-decision) → ADR-0072 (`OpfsFsSync` = per-realm snapshot + async write-through, NOT live-coherent) → ADR-0080 (async cross-realm read; the "sync-over-OPFS-without-SAB" lean) → ADR-0084 / ADR-0011 (SAB ring + sync IPC — the transport B reuses) → ADR-0137 (FROZEN bin API).

**Where it breaks (the dead link):**
- `apps/playground/src/workers/node-entry-bootstrap.ts:28-33` — `runNodeEntry({ vfs: syncMirror(), … })`; `syncMirror()` here = the worker's OWN empty store.
- `packages/runtime-js/src/builtins/node-entry.ts:50` — `opts.vfs.readFileBytesSync(opts.entryPath)` → ENOENT. (`parseBinLauncherTarget` :30, `runNodeEntry` ~:47.)

**Where the shell's node_modules ACTUALLY live (PAGE memory):**
- `apps/playground/src/App.tsx:174` `npmVfs = new SyncMirrorVfs()` (over PAGE `syncMirror()`), `:326` `npmCommand` installs through it, `:82-88` the "same store the shell + npm install write to" comment.
- bin resolution runs on PAGE, sync: `packages/shell/src/bin-resolver.ts:20` `resolveBin` / `:22` `syncMirror()`. Frozen API: `packages/shell/src/shell.ts:33` `BinExecutor` / `:44` `execBin`.
- who spawns the bin worker: `App.tsx:355-385` (`createBinExecutor` + `spawn`), `apps/playground/src/glue/bin-executor.ts:34` `BinSpawnRequest` / `:44` `spawn` seam / `:59` `createBinExecutor`.

**Proof "all playground workers are memory-backed" (kills the OPFS premise):**
- `apps/playground/src/workers/kernel-worker-entry.ts:25,36` — pre-entry hook installs ONLY the process shim; `installWorkerEntry()`.
- `rg -n "initBackend|installOpfsFs|OpfsFsSync" apps/playground/src/workers` → **nothing**. `flushSyncMirror` (real-vite-bootstrap.ts) no-ops on `MemoryFsSync`.
- default store: `packages/vfs/src/sync-mirror.ts:109` `new MemoryFsSync()`; swap seam `:168` `setSyncMirror`; getter `:113` `syncMirror`. Boot: `packages/vfs/src/boot.ts:32` `initBackend` (page → memory; OPFS sync is worker-only).

**SAB transport to reuse for B (worker→PAGE sync RPC):**
- per-spawn ring: `packages/kernel/src/spawn-worker.ts:17` `createSabRing` (+ ADR-0084 / ADR-0011 / ADR-0032).
- existing handler/runner pattern: `packages/runtime-js/src/ipc/handlers.ts` (`installRuntimeJsExecSyncHandler`, `runWorker` seam :43, builds `kind:'source'`); `packages/runtime-js/src/ipc/recursive-runner.ts:45` `makeRecursiveRunner` (+ `:16` imports `spawnKernelWorker`).
- install the SAB-backed `FsSync` as `syncMirror()` BEFORE `runNodeEntry`: hook point `packages/kernel/src/worker-entry.ts:135` `setKernelPreEntryHook` (current hook = process shim).

**Existing cross-realm read to mimic for D (async, owner-served):**
- `apps/playground/src/glue/node-modules-port.ts:98` `serveNodeModulesReads` (worker serves reads from its realm-local `syncMirror()`); plus `vfs-snapshot-port.ts` / `vfs-write-port.ts`. This IS the D viewer machinery, already shipped for the preview owner.

**OPFS/persistence cost facts (if persistence is added under D):**
- `packages/vfs/src/opfs-sync.ts:211` `static init` → `:236` `preloadContent` (reads every file's bytes, O(total bytes)) → `:513` `flush`.

**execSync — the SAFE increment (independent of B/D, landable now):**
- move entry-kind choice into the recursive runner: browser → node-entry bootstrap via `packages/runtime-js/src/builtins/node-entry-url.ts:14` `setNodeEntryWorkerUrl` / `:19` `getNodeEntryWorkerUrl`; the `child_process.spawn` model is `packages/runtime-js/src/builtins/child_process-worker.ts:40` `spawnWorkerChild` (`kind:'url'` ~:61). Node conformance keeps loader-running source.
- the constraint that blocks a naive flip: `tests/conformance/builtins/child_process.test.ts:120` `runWorker: async () => ({ stdout, exitCode: 0 })` (runs in Node, can't execute `kind:'url'`). Failing test FIRST.

**First moves:**
- *Safe increment now:* failing conformance/unit → push entry-kind decision into `recursive-runner.ts` (browser vs Node). No transport. REVERSIBLE.
- *If B (stepping stone):* (1) PAGE: register `statSyncOrNull`/`readFileBytesSync`/`existsSync` handlers on the execSync dispatcher, served from PAGE `syncMirror()`; (2) worker: SAB-backed `FsSync` issuing sync RPC over the spawn's `SabRing`, blocking on `Atomics.wait`, installed in the pre-entry hook before `runNodeEntry`; (3) COI e2e: `npm install <pkg-with-bin>` on PAGE → run bin → assert stdout. Batch reads (UI-jank, above); gate behind a deletable seam.
- *If D (destination, milestone):* `pnpm adr:new shell "Bin/shell execution: owner-worker vs SAB fs-proxy"`, then phase — P1 persistent workspace-owner worker (one store, runs `npm install` + bin/execSync in-realm); P2 PAGE terminal → thin client over a pty-like channel; P3 generalize snapshot/nm-read/vfs-write ports for editor/explorer; P4 **unify with the real-vite preview owner** (else two-owners trap, risk #2); P5 OPFS persistence in the one owner (accept preload cost); P6 SAB sync-views for concurrent spawned processes (risk #1). Gate P1 on lifetime model (risk #4) + #2.

**Verify:** `pnpm test:run` · `test:conformance` · `test:parity` · `test:e2e` (COI) · `backlog:check` · `refs:check` · `check:deps` · `docs:check`.

**Non-negotiables (don't re-litigate):** node_modules are in PAGE memory today; NO shared OPFS; `OpfsFsSync` is a per-realm snapshot, not live-coherent; sync OPFS is worker-only; `BinExecutor`/`execBin`/`setNodeEntryWorkerUrl`/`runNodeEntry` are FROZEN (ADR-0137); the mechanism (`runNodeEntry` + loader) is proven (node unit + parity `modules/{cjs,esm}-shebang`) — only the TRANSPORT is missing.

## Reversibility

IRREVERSIBLE — changes the execution model + which realm owns node_modules, touches the ADR-0137 host-wiring seam, and contradicts the recorded next-step in `shell/node-modules-bin-execution`. Decide via `pnpm adr:new shell "Bin/shell execution: owner-worker vs SAB fs-proxy"`; the superseding ADR corrects the false premise in that backlog item and cross-refs ADR-0135 / ADR-0137 / ADR-0080 / ADR-0072. This doc = pre-ADR analysis.
