---
area: shell
status: active
title: D owner-worker execution model — milestone tracker (P1-P6)
created: 2026-06-14
why: ADR-0143 decided D (one owner-worker holds node_modules + runs the shell/CLI/execSync in-realm; PAGE = viewer). It is milestone-scale + multi-ADR; this tracks the phases, decided forks, ordering, and per-phase status so the work is explicit, not silent backlog.
user_story: As a developer at the rifty prompt, I `npm install cowsay` then run `cowsay hi` and want the CLI to actually run (and the editor/explorer to reflect the same tree) — today the bin worker can't see the shell's node_modules (ENOENT). Delivered when one owner-worker runs install + CLIs in-realm and the PAGE is a thin viewer.
sources: [ADR-0143, ADR-0144, ADR-0077, ADR-0011, ADR-0080, ADR-0072, M11]
code: [packages/kernel/src/worker-entry.ts, packages/kernel/src/spawn-worker.ts, apps/playground/src/workers/real-vite-bootstrap.ts, apps/playground/src/glue/realVite.ts, apps/playground/src/adapters/terminal-manager.ts, packages/shell/src/shell.ts, apps/playground/src/App.tsx]
---

## Context

ADR-0143 chose **D (owner-worker)** over B (SAB fs-proxy). D is milestone-scale (blast radius kernel + shell + terminal + playground + net) with several IRREVERSIBLE sub-decisions → its own ADRs. Subsystem map (verified 2026-06-14): kernel process model is mature (`WorkerProcessHandle` already has stdin/stdout/stderr streams + kill + IPC); the real-vite preview worker is the working "owner" prototype (owns its install, serves the page over snapshot/nm-read/write ports, stays alive). Most of D = generalize that owner into the shell's home + give the kernel a real persistent-process lifecycle.

### Decided forks (recorded; do not re-litigate)

- **One owner per workspace** hosts BOTH the shell and the preview (ADR-0143 destination; separate owners = the two-owners trap). The dev server is **co-resident** in the owner realm for v1; true concurrency ("shell responsive while `vite` runs") needs P6 (SAB sync-views, worker→worker).
- **P2 pty channel** = the existing structured line/chunk/signal/stdin/exit protocol (matches the current terminal contract), NOT a raw-byte pty.
- **Whole Shell moves** into the owner-worker (`packages/shell` is realm-agnostic — io+vfs only); the PAGE terminal keeps local line-editing (it already fires one line per Enter) and becomes a thin client; cwd/env/execution live in the owner.

## Phases (ordering: P1 gate → P2 + P3 → P4 → P5 → P6)

- **P1 — kernel server-process model. ✅ LANDED (ADR-0144).** `serve` flag on `WorkerSpawnSpec`/`SpawnWorkerSpec`; the kernel no longer reaps a `serve` worker when its entry settles cleanly (`finalizeWorkerEntry`). real-vite migrated off the `await new Promise<never>(()=>{})` keep-alive hack. Unit-tested (`worker-entry-serve.test.ts`); real-vite COI e2e re-verify pending a COI run.
- **P2 — PAGE terminal → thin client over a pty channel. ✅ LANDED (ADR-0146).** `Shell` + cwd/env + npm-install + bin/`execSync` run in one persistent workspace-owner (`real-vite-bootstrap` mode-parametrized `shell`|`preview`, spawned `serve:true` at App-mount, addressed by `workspaceId`). pty channel = `pty:*` frames on the kernel fork-IPC port (control + stdout/stderr chunks on ONE ordered channel → no chunk-vs-exit race; `sessionId`+`runId`; cwd/env pushed on `pty:exit`; structured `pty:ready` replaces the stdout log-match + retry-storm). New `pty-protocol`/`pty-server`/`pty-client`/`owner-bin-executor`; `terminal-manager.ts` → pty port client; dead `shell-adapter`/`useShellSession` removed. npm + bin run in-realm against the owner `syncMirror` (kills ENOENT). Persisted cwd/env restored via `pty:open` seed; `npm run <dev>` routed page-side (pre-P2 parity). No kernel/`shell`/`terminal` source change. Unit-tested (`pty-*`, owner session, thin client); COI e2e `owner-shell-cowsay.spec.ts` (CI-only). **Tracked transient → P4:** the dev-server preview owner stays separate (page-driven `dispatchDevServerLine`) so the preview does NOT yet see terminal-installed deps; **P4** folds the vite tail co-resident into THIS persistent owner (subsumption, not rewrite) — zero residual debt at D close. **Post-merge fixes (CI e2e, COI-only, missed at local green):** (1) fork-IPC message-drop race — `WorkerNodeProcessShim` dropped `ipc:message` frames emitted before the slow owner bootstrap registered `process.on('message')`, so `pty:open` was lost and EVERY shell command hung (no output); fixed by buffering+flush-on-first-listener in `runtime-js/ipc/install-process.ts` (`install-process-ipc.test.ts`). (2) preset `files[]` reached only the preview worker → owner shell ENOENT; `seedViteWorkspace` now pushes them to the owner via new `WorkspaceOwnerHandle.writeFile`. (3) PAGE-driven dev tab `data-running=false` → tabs reflect `devServerRunning` for the owning session. (4) cowsay e2e raced the install (matched mid-stream `+ cowsay@`, typed into busy shell) → waits for the install-complete summary. e2e-chromium green.
- **P3 — generalize the owner-served ports** (snapshot / nm-read / vfs-write) so the PAGE editor/explorer read+write the owner store the same way the thin terminal does. Reuses shipped machinery; widen node_modules-scope → general read; add write-coherence (owner = source of truth). Sibling of P2.
- **P4 — unify with the real-vite preview owner.** `vite`/dev runs in the SAME owner that holds node_modules + the shell (not a separate worker), so the dev server reads just-installed deps directly. Depends on P1+P2. The headline risk (two-owners trap) lives here.
- **P5 — OPFS persistence in the one owner.** Wire `initBackend`/`OpfsFsSync` into the owner (memory-backed today); accept the ADR-0072 `O(total bytes)` preload cost; add graceful stop (drain/flush) to the P1 server-process model.
- **P6 — SAB sync-views for concurrent spawned processes** (worker→worker, B's mechanism served the right direction) — restores "shell usable while a CLI/dev-server runs" by giving each foreground process its own realm sharing the owned store. Needed because the single owner realm is one JS thread.

## Open design forks (resolve at the owning phase)

- P2: per-session isolation — N in-realm Shells in one owner (shared thread) vs one worker-process per session (needs P6). v1 = shared; isolation at P6.
- P2: cwd/prompt ownership — owner is source of truth, pushes cwd snapshots to PAGE for the prompt + persistence.
- P4: is the dev server a co-resident task or a child worker-process the owner supervises? v1 co-resident; supervisor at P6.

## Implementation map — verified seams (2026-06-14)

Per-phase file:line seams from the subsystem deep-map (re-verify on touch; the repo moves). Read order for a fresh agent: this doc → ADR-0143 + ADR-0144 → `bin-worker-vfs-transport-b-vs-d.md` "Entry points" (transport/ENOENT seams) → the files below.

**Kernel process model (P1 landed — reference for P2/P6):**
- `packages/kernel/src/worker-entry.ts` — `installWorkerEntry` (:234) `onMessage` runs entry then calls `finalizeWorkerEntry` (the `serve` reap decision); `WorkerSpawnSpec.serve` (added P1); entry kinds `WorkerEntryDescriptor` (:71 source|url); `setKernelPreEntryHook` (:135).
- `packages/kernel/src/process-manager.ts` — `globalProcessManager` (:479); `spawnWorker` (:288); `WorkerProcessHandle` (:97) ALREADY has `stdin()/stdout()/stderr()` streams (:346-357) + `send`/`disconnect` IPC + `kill` (:427). The pty channel (P2) reuses this stdio triple; `kill` is hard-terminate (graceful stop = P5).
- `packages/kernel/src/spawn-worker.ts` — `spawnKernelWorker` (:117), `SpawnWorkerSpec.serve` (added P1), `createSabRing`/dispatcher attach (:135/:174).
- `packages/kernel/src/ipc/{sync-dispatch.ts,sync-client.ts}` — `register(method,handler)` (dispatch :134) + in-worker `SyncRpcClient.call` (:57, Worker-only). P6 registers an `fs.read` method here (owner serves, child reads) — B's mechanism, worker→worker.

**P2 — relocate Shell + pty channel + relocate npm/bin execution:**
- `apps/playground/src/adapters/terminal-manager.ts:86` `new Shell({cwd,env,execBin})` → Shell + cwd/env MOVE into the owner-worker; terminal-manager becomes a thin port client. `:124` `toSnapshot` (cwd/envSnapshot) → async reads / pushed snapshots.
- `terminal-manager.ts:147` `runLine→shell.run` → send line over the pty channel, stream stdout/stderr chunks + exit code (replaces local `onChunk` `shell.ts:534`). `:221/:264` `writeStdin`/`StdinQueue` → keystrokes cross as stdin frames; `read()→Promise<Uint8Array|null>` = stream frame + EOF; Ctrl-C = SIGNAL frame.
- `packages/shell/src/shell.ts` — `run` (:243), `runSegment` (:467), dispatch order (:530/:564), redirect flush (:614). Shell is realm-agnostic (`package.json` deps = io+vfs only) → moves WHOLESALE into the owner; no shell-pkg code change, only the realm + host wiring flip. `bin-resolver.ts:20` `resolveBin` reads the owner `syncMirror()` in-realm.
- `packages/terminal/src/terminal.ts` — pty contract surface: `onInput(line)→exitCode` (:1376), `write(chunk,stream)` (:816), `onSignal('SIGINT')` (:1547), `onRawInput` (:980), `writePrompt` (:951, prompt ownership → owner pushes cwd).
- `apps/playground/src/App.tsx:355` `createBinExecutor` + `glue/bin-executor.ts:59` → per-bin worker spawn COLLAPSES; owner runs the resolved shim IN-REALM (local sync VFS, no ENOENT). `BinExecutor`/`execBin` stay frozen (ADR-0137).
- `App.tsx:326` `npmCommand` (over PAGE `npmVfs=SyncMirrorVfs` :174) + `glue/npm-shell-command.ts` → npm install writes the OWNER store; `flushSyncMirror` (:321) + install-stamp move with it. (Without moving npm + bin into the SAME owner, ENOENT returns.)
- Owner entry: generalize `real-vite-bootstrap.ts` into a workspace owner that hosts a `Shell` reading the kernel stdin port + writing stdout, dispatching in-realm; spawned `serve:true` (P1). Needs its own ADR (pty channel shape).

**P3 — generalize owner-served ports (already shipped for preview):**
- `apps/playground/src/glue/node-modules-port.ts:98` `serveNodeModulesReads` (widen the `isUnderNodeModules` guard :74 → general read), `vfs-snapshot-port.ts` (`collectSnapshot` :65 full-tree-replace → consider delta for a live-mutating tree; `publishVfsSnapshot` :134; `subscribeVfsSnapshot` :145), `vfs-write-port.ts` (`serveVfsWrites` :111, `applyVfsWriteFrame` :62). Write-coherence: owner = source of truth; page editor writes become requests applied + re-broadcast (the one-way/read-only assumption breaks under a writing shell).
- Readiness: replace the stdout log-string match (`App.tsx:233`) + publishSnapshot retry-storm (`:354`) with a structured owner-ready handshake.

**P4 — unify with the real-vite preview owner (the two-owners trap):**
- `App.tsx:334` `viteCommand` / `:191` `runViteCommand` → `vite`/dev runs in the SAME owner that holds node_modules + the shell (not a separate `startRealVite` worker). `glue/realVite.ts:67` `startRealVite` (already spawns `serve:true` post-P1) → generalize into the workspace owner. Co-resident dev server in v1.

**P5 — OPFS persistence in the one owner + graceful stop:**
- `apps/playground/src/glue/sync-mirror-vfs.ts:16` `SyncMirrorVfs` → delegate to `OpfsFsSync` not `MemoryFsSync`; `packages/vfs/src/opfs-sync.ts` (`init` :211, `preloadContent` :236 = O(total bytes), `flush` :513), `boot.ts:32` `initBackend` (wire in the owner; sync OPFS is worker-only). `project-deps.ts:64` flush hooks (:389); `real-vite-bootstrap.ts:164` `flushSyncMirror` (no-op on memory today). Add graceful stop to the ADR-0144 server-process model (drain stdio + flush before terminate).

**P6 — SAB sync-views for concurrent processes:**
- Owner SUPERVISES child worker-processes sharing the owned store via SAB sync-views (worker→worker, B's mechanism served the right direction — no UI jank). Build an `fs.read` sync method on the owner's dispatcher (`sync-dispatch.ts register`) + child reads via the published `SyncRpcClient` shim (`sync-client.ts`). Restores "shell responsive while `vite` runs".

**Carry-forward risks:** single JS thread contention (→P6); concurrent writers to one tree (→P3 coherence); hard-kill only (→P5 graceful stop); whole owner needs `crossOriginIsolated` (no PAGE fallback under D); readiness handshake (P3).

## Reversibility

IRREVERSIBLE milestone. P1 recorded in ADR-0144; P2/P4 (and P6) will each get their own ADR at their phase. P3/P5 are largely REVERSIBLE extensions of shipped ports/persistence (CHANGELOG unless a wire-format/contract change makes them IRREVERSIBLE).
