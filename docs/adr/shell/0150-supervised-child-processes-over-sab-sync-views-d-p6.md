# ADR 0150: Supervised child processes over SAB sync-views (D P6)

Status: Accepted (2026-06-16)
Date: 2026-06

> TL;DR: Each foreground CLI/dev-server runs in a SUPERVISED CHILD worker-process; the owner becomes a pure async supervisor + fs-server, serving the child's sync `fs.*` over the existing SAB sync-RPC ring (owner = single source of truth, read+write, chunked). Closes D's last accepted-until-P6 debt ("shell usable while a CPU CLI / `vite` runs"). IRREVERSIBLE — new `fs.*` wire surface.

> Correction 2026-07-13 (ADR-0174): the dedicated dev-server child now owns
> node-server templates only; Vite runs in the generic `.bin` child. Its
> owner→child file-change IPC is retired; the supervised-child/fs.* invariant
> is unchanged.

## Context

D milestone (ADR-0143) destination: the process owns its filesystem, the UI is a viewer over a port — WebContainers-shaped. P1–P5 landed one persistent workspace OWNER worker holding `node_modules` + running the shell, dev server, npm, and bin/CLIs ALL in-realm against one `syncMirror()`. Single JS thread → a CPU-bound CLI or a `vite` transform burst stalls every other shell session + the snapshot/nm/vfs-write bridge replies (ADR-0148 accepted this "until P6"). ADR-0143 fixed the P6 destination: *"SAB sync-views for concurrent spawned processes … B and D compose at the limit (WebContainers = owned store + SAB sync views)"*; acceptance: *"a CPU-bound CLI stalls everything else … until P6; true 'shell usable while `vite` runs' needs P6."*

**Scope was NOT an open fork — it is derivable from goals.** Tracker P6: *"giving EACH FOREGROUND PROCESS its own realm sharing the owned store."* Tracker P4 open-fork resolution: *"dev server … supervisor at P6."* So both CLIs AND the dev server move to supervised children. Alternatives (dev-server-only; CPU-CLI-only) fail the acceptance.

**Binding invariant from adversarial verification (the load-bearing fact).** The owner's `SyncRpcDispatcher` pumps replies via `Atomics.waitAsync` → a **microtask** (`sync-dispatch.ts:228`), which runs ONLY when the owner thread is idle. If the owner runs blocking synchronous work, a child's `fs.read` (`Atomics.wait`, `sync-client.ts:57`) stalls until the backstop timer. ⇒ **The supervisor invariant: blocking work MUST live in the child; the owner does only async supervision + fs-serving.** This is exactly why "dev-server-only in child" is self-defeating (a co-resident CPU CLI would block the owner and starve the dev-server child's `fs.read`) and why ALL foreground work moves off the owner thread.

Feasibility verified: recursive spawn from the owner works (COI proof: `execsync-harness*.ts` — a worker sets `setKernelWorkerUrl`, registers a dispatcher handler, spawns a child that calls back via `SyncRpcClient`); `register(method, handler)` (`sync-dispatch.ts:134`) is generic; binary replies carry bytes verbatim (ADR-0084). Constraint: the SAB ring payload is 1 MiB (`RingPayloadTooLargeError`) and single-request → reads/writes chunk.

## Decision

**Every shell-resolved foreground bin/CLI and the dev server run in a supervised CHILD worker-process. The owner is the supervisor + fs-server.** Sequenced, subsume-not-rewrite:

- **P6a — CLI/bin → child.** Swap the injected `BinExecutor` (frozen seam, ADR-0137; `shell.ts:33`) from the in-realm `createOwnerBinExecutor` (`owner-bin-executor.ts:84`) to a child-spawning executor (reuses the page-side spawn/stream/kill template `glue/bin-executor.ts` over `globalProcessManager.spawnWorker`). Bin RESOLUTION stays owner-side (`resolveBin`, `bin-resolver.ts:20` — pure VFS walk); the owner hands the child the absolute shim path + argv + cwd + env. Shell, pty-server, terminal-manager unchanged.
- **P6b — dev server → child.** The dev-server-controller's injected `boot` (`dev-server-controller.ts:89`) spawns a child instead of running `bootDevServer` in-realm; the preview + net bridges (`serveCrossRealmPreview`/`setupPreviewBridge`) relocate to the child realm that owns `listen()`. State machine unchanged.

**fs surface — owner serves, child reads+writes (chunked), owner = SSoT.** The owner registers `fs.*` handlers on `getKernelDispatcher()` (mirror of `installRuntimeJsExecSyncHandler`, `handlers.ts:66`) reading/writing its `syncMirror()`. The child's `node:fs`/module-loader reads the owner store through a remote `FsSync` (new `SyncRpcFsSync`, runtime-js) whose 13 methods delegate to the published `KernelSyncApi.call('fs.*', …)` (`shared-globals.ts:108`); installed in the child before `runNodeEntry` (`node-entry-bootstrap.ts`, the realm whose empty `syncMirror()` is today's ENOENT, lines 13-18). Read+write (not read-only) — `tsc`/`esbuild` write outputs; writes route to the owner and land in the one tree, so the explorer/editor reflect them via the existing `pty:exit`→`publishSnapshot`. Large files/dirs chunk over the 1 MiB ring (offset+length; never silent-truncate). fd table stays child-local (`fs.ts` fdTable) — no fd-level RPC.

## Consequences

- (+) Closes D's last accepted-until-P6 debt: shell + other sessions + bridges stay responsive while a CPU CLI or `vite` runs; matches the WebContainers "owned store + SAB sync views" end-state.
- (+) Owner-as-supervisor satisfies the `waitAsync` invariant by construction (no blocking work left on the owner thread).
- (−) Per-CLI spawn latency (~worker boot) on every resolved bin (builtins stay in-realm — the `BinExecutor` seam fires only for `.bin`/node entries). Worker-pool optimization deferred → backlog.
- (−) Child `require()` resolves `node_modules` via many sequential `fs.*` round-trips over the ring (~stat storms). v1 accepts the cost; optimization (child reads immutable `node_modules` direct from shared OPFS, P5; or a resolver-cache image at spawn) → backlog, NOT v1 (ADR-0143: cross-realm fs is the bug class — keep one served store as SSoT).
- (−) P6b relocates the just-stabilized P4 preview/net machinery into the child realm — re-test the preset-switch + node-server path (the gold e2e).
- (−) Concurrent writers to one OPFS tree (owner write-through + child writes via owner RPC) — mitigated because child writes route THROUGH the owner (one writer to OPFS), not a second OPFS opener.
- Follow-ups: graceful child drain on terminate (`backlog: shell/owner-graceful-drain-on-terminate`); worker-pool / resolver-image perf; node-server graceful dev-server stop (P5-deferred) folds into P6b's child lifecycle.

**P6a landed (2026-06-16).** Recursive-spawn-from-owner + the remote VFS validated end-to-end (COI e2e `owner-shell-cowsay`: the child reads `node_modules` + cowsay's `.cow` files over `fs.*` RPC and draws). As predicted ("the persistent-owner unification exposes a CLASS of per-realm shim gaps the fresh-worker model hid"), running a real CLI in a child surfaced + fixed three latent gaps: the child `process` lacked Node identity fields (→ shared `NODE_PROCESS_IDENTITY`); `node:fs` read the empty realm mirror not the owner (→ `installRemoteSyncFs` swaps the child's GLOBAL mirror); child `console.*` wasn't wired to its stdout port (→ `installConsole` in the bootstrap). P6b (dev server → child) remains.

**P6b landed (2026-06-17).** Dev server → supervised child: the `dev-server-controller` injected `boot` (now `dev-server-controller.ts:37`, NOT the cited `:89` — line drift; state machine unchanged) spawns a `serve:true` child (`createOwnerChildDevServer` → `dev-server-child-bootstrap`) instead of running `bootDevServer` in-realm (`bootDevServer` extracted to `dev-server-boot.ts` so the child can import it); the child reads+writes the owner store over the P6a `fs.*` ring. Owner↔child control rides fork-IPC (`rifty:dev-ready`/`-error`/`-snapshot`, `rifty:dev-file-changed`); `RIFTY_DEV_SERVER_WORKER_URL` threads the child entry page→owner. node-server graceful stop folds in via fresh-child-per-run (re-listen-on-restart). Gold e2e (`m1`/`m7`/`fullstack-demo` preset-switch) + prod smoke green; the gold e2e caught a child PORT-threading bug (the node-server entry bound the owner's spawn-default port — fixed by setting `PORT`=devPort in the child spawn env, the clobber-safe source).
- **Corrected — Decision (line 23):** only `serveCrossRealmPreview` relocates to the child. `setupPreviewBridge` is page-side and no-ops in any worker realm (`!('serviceWorker' in navigator)`, `preview-bridge.ts`), so it was already inert in the owner worker; the SW-direct route stays page-anchored (`mountPlaygroundPreviewBridge`). Putting it in the child would be a forbidden silent no-op.
- **Corrected — consequence (+) (line 29):** "shell stays responsive while `vite` runs" is delivered as a STRUCTURAL guarantee (the dev server is a separate worker — it cannot block the owner thread), NOT as an observable shell-latency win for current workloads. Empirically the co-resident install/transform pipeline already yields end-to-end (async throughout), so it never synchronously starved the owner; a latency RED→GREEN is not demonstrable without a synchronous owner-hog workload (honest gap recorded in `process-meta/test-coverage-debt`). The `waitAsync` supervisor invariant (no blocking work on the owner) holds by construction regardless.

## Reversibility

IRREVERSIBLE — adds a public `fs.*` sync-RPC method surface (new wire contract over the ADR-0011/0084/0032 ring) + a child-resident remote `FsSync`. Builds on frozen seams (ADR-0137 `BinExecutor`, ADR-0039 pre-entry hook + recursive spawn, ADR-0144 serve, ADR-0148 dev-server-controller). Does not supersede them. Relates: ADR-0143, 0011, 0084, 0032, 0039, 0137, 0144, 0146, 0148, 0072.

> **Correction 2026-07-26 (ADR-0326/0327):** P6b `rifty:dev-*` and descendant
> lifecycle frames use ADR-0326's private control lane, not public fork IPC.
> The dedicated Node-server controller applies only to canonical direct-entry
> script bytes; installed nodemon executes through the generic `.bin` child.
> Owner-backed sync-FS and supervised-child isolation stand.
