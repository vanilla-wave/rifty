# Changelog

## [Unreleased]

### Changed

- **Shared `runForegroundChild` driver** (closes backlog/playground/owner-child-foreground-shared-driver). The owner `node <file>` executor and the `.bin` executor no longer each re-implement decode + stream + Ctrl-C-kill/mute + settle-on-exit (ADR-0155 §1 recorded the drift risk) — both ride `glue/run-foreground-child.ts`. The node executor passes its `rifty:node-listening` hook + preview-registry remove; the bin executor passes neither. Side benefit: the bin executor inherits the exit-listener-before-pre-abort ordering its inline copy lacked, so a `node_modules/.bin/<cmd>` launched with an already-aborted signal no longer hangs (kill() emits `'exit'` synchronously). The dev-server child keeps its own driver (resolves on a `rifty:dev-ready` message, not exit).

- **`node <file>` missing-entry diagnostic is now real Node's `MODULE_NOT_FOUND`** (closes backlog/runtime-js/node-entry-miss-node-shape). `resolveNodeEntry` no longer pre-checks existence (it just absolutizes the arg); a missing entry flows into `runNodeEntry` → the module loader, which emits Node's `Error: Cannot find module '<abs>' … { code:'MODULE_NOT_FOUND', requireStack: [] }` on the child stderr (exit 1) instead of the old terse `node: cannot find module '<abs>'`. The empty-arg usage error is the only owner-side `ok:false` left.

### Added

- **Page preview bridge advertises served ports** (ADR-0160). The window-owner
  `rifty:preview:ready`/`goodbye` frames now carry the `ports` the page owns, so
  the SW routes copied-tab (`/preview/<port>/`) traffic port-keyed to the owning
  window instead of misrouting across multiple playground windows.

- **Terminal `node <file>` command** (ADR-0155). Runs an arbitrary entry as a supervised child of
  the workspace owner — the symmetric twin of the `.bin` child (`runNodeEntry`, ADR-0137), NOT the
  template dev-server. A run-to-completion script streams stdout/stderr and exits on event-loop drain
  (ADR-0152) with its code; a script that calls `listen()` stays alive (`serve:true`), registers its
  port for preview, and is stopped by Ctrl-C — server-vs-script decided by what the program does, not
  a flag. New `workers/owner-child-node-executor.ts` (spawn spec `RIFTY_BIN=0`/`RIFTY_NODE_SERVE=1`/
  `serve:true` + stream/SIGINT-kill/exit + `rifty:node-listening` IPC), `workers/node-program-lifecycle.ts`
  (run-vs-serve decision), `workers/node-entry-resolve.ts` (cwd-resolve + `node: cannot find module`),
  `workers/preview-registry.ts` (multi-port set), `glue/node-child-ipc.ts`; `node-entry-bootstrap.ts`
  gains the `RIFTY_NODE_SERVE` serve branch (net builtins always); `real-vite-bootstrap.ts` registers
  the `node` command + the preview registry; `PreviewPanel.tsx` gains a multi-port switcher;
  `pty-protocol.ts` gains `pty:preview`/`pty:preview-req`. Interactive stdin is not forwarded — the
  child's `process.stdin` consume surface throws `NotImplementedError` (`node-stdin-guard.ts`) rather
  than hanging (Fidelity). Other gaps (bare-node `node:sqlite`, cross-realm loopback) are backlogged;
  trailing `node x.js &` runs via the shell's generic background path (job-control builtins are the
  gap). E2E: `tests/e2e/node-command.spec.ts`.

- **Page preview-port registry + per-node-port preview bridge** (ADR-0155). `glue/pty-client.ts`
  gains `onPreview`/`requestPreview` mirroring the `onDevServer`/`requestDevServer` discipline:
  routes owner→page `pty:preview{ports}` snapshots to subscribers + sends `pty:preview-req`.
  `glue/realVite.ts` exposes them on `WorkspaceOwnerHandle` (preview listener set, spawn-time
  handshake beside the dev-server one, empty-set publish on owner exit). `App.tsx` keeps a
  `previewPorts()` signal fed to `PreviewPanel`'s switcher, requests a re-publish on subscribe, and
  wires a per-port SW preview bridge for NODE-source ports ONLY (the dev-server port keeps its
  existing `onDevServer` bridge — never double-wired) via a diffing effect over a port→teardown Map.

- **Event-loop keepalive + drain wired into the kernel worker** (child-realm-async-lifecycle,
  ADR-0152). `workers/kernel-worker-entry.ts` now calls `installEventLoopKeepalive()` (right after
  `installTimerGlobals()`), so a run-to-completion child drains its event loop before reaping —
  post-top-level async (timers, detached `import().then(run)`) completes — and fails loudly (stderr +
  exit 1) on an unhandled rejection or a never-draining loop, instead of silently exiting 0.

- **Supervised dev-server child entry + config resolver** (P6b, ADR-0150).
  `workers/dev-server-child-config.ts` is a pure, LIGHT-import resolver
  (`resolveDevServerChildConfig`) that rebuilds the boot config (spec/cfg/port/root/slug/
  fromScratch) from the spawn env, with loud throws on a missing required var (and a
  non-integer port) — unit-tested without pulling vite/sql.js. `workers/dev-server-child-bootstrap.ts` is the heavy
  `kind:'url'` child entry the owner spawns to run the dev server out of the owner thread: it reads
  the owner store over fs.* sync-RPC (`installRemoteSyncFs`, RIFTY_REMOTE_FS=1), boots via
  `bootDevServer`, and talks to the owner over fork-IPC (`rifty:dev-ready`/`-error`/`-snapshot` out,
  `rifty:dev-file-changed` in). `registerNetBuiltins`/`registerSqliteBuiltin` + the boot run INSIDE a
  guarded entry fn (only when `readKernelProcessSpec() !== null`), so importing the module under
  vitest has no heavy side effects. The owner spawn-to-child flip is a later task.

### Changed

- **Owner spawns the dev server as a supervised child instead of booting it in-realm** (P6b flip,
  ADR-0150). The owner's dev-line boot closure (`real-vite-bootstrap.ts`) no longer calls
  `bootDevServer` in its own thread; it now spawns the dev server through
  `createOwnerChildDevServer(devServerWorkerUrl)` — a serve:true child (`dev-server-child-bootstrap`)
  that reads+writes the owner store over fs.* sync-RPC. The owner stays a free async supervisor; the
  driver resolves when the child reports listening, and the controller's stop() kills the child (a
  fresh child per run → re-listen on restart). The new child entry URL threads page→owner over
  `RIFTY_DEV_SERVER_WORKER_URL` (`realVite.ts` spawn env → owner bootstrap guard → `bootShellOwner`).
  The owner-realm template-switch clean (rm node_modules/lockfile/package.json on a preset switch)
  and the editor-write→HMR + snapshot wiring are unchanged. The owner no longer imports/calls
  `bootDevServer` (kept only for the child + `flushSyncMirror`).
- **Extracted the co-resident dev-server boot core into `workers/dev-server-boot.ts`** (P6b prep,
  ADR-0148/0150). `bootDevServer` + the vite/node-server tails (`bootNodeServer`,
  `waitForListeningPort`, `overlayShims`, `toRootRelativePath`,
  `flushSyncMirror`, the Vite interfaces) moved verbatim out of `real-vite-bootstrap.ts` (which has a
  top-level `await bootstrap()` so it can't be imported) into an importable, side-effect-free module
  so a P6b child realm can import it. No behavior change: the owner still imports `bootDevServer` and
  calls it in-realm exactly as before; the spawn-to-child flip is a later task.
- **One spec-seeded mutable Node `process` at the pre-entry seam; removed the post-spawn
  `globalThis.process` swap** (ADR-0157). `node-entry-bootstrap.ts` no longer calls
  `installRuntimeGlobals()` (the `installProcessGlobals` swap that orphaned argv/cwd/stdin);
  `proc = globalThis.process` is the rich seeded process throughout (`postListening` uses
  `proc.send`). `worker-runtime-globals.ts installRuntimeGlobals()` degrades to a thin fork-IPC
  handle accessor (no process/Buffer/timers swap) — still used by `dev-server-child-bootstrap` +
  `real-vite-bootstrap` for `{send,onMessage}`; `setProcessCwd(root)` retained where the realm
  overrides cwd. The pre-entry hook (`kernel-worker-entry.ts`) installs the rich process gated to
  Node workers (`isNode = no __RIFTY_WASI_WASM_URL`). Brittle `real-vite-bootstrap.test.ts`
  source-greps for `installRuntimeGlobals()` replaced with behavioral assertions.
- **Preview panel mounts on node-server ports even when the dev server is stopped** (ADR-0155 §3
  follow-up). `hasPreview()` now ORs `previewPorts().length > 0`, the `<Show>` no longer re-keys on
  `realVitePort()` (PreviewPanel self-reconciles its selection — a dev-port change no longer resets
  the chosen node port), and `previewUrl`/`openPreviewTab` accept any registered preview port (not
  only when the dev server runs) so "open in new tab" no longer silently no-ops for a node-only preview.

### Fixed

- **`node <file>` server now sees its real `process.argv`/`process.cwd()`/`process.stdin`** (ADR-0157).
  The `RIFTY_NODE_SERVE` bootstrap previously read `proc = globalThis.process` (the seeded shim) then
  swapped `globalThis.process` to the default `riftyProcess` (`argv=['rifty','repl']`, `cwd='/workspace'`,
  bare stdin), so user code saw the wrong argv/cwd and the stdin loud-guard was installed on the
  ORPHANED old object. The unified seeded process eliminates the swap → argv/cwd/stdin are correct by
  construction and the loud-guard patches the object user code actually reads.
- **`node-stdin-guard.test.ts` was false-green** (ADR-0157) — it asserted against a synthetic
  `{ stdin: {} }` the guard fully replaced, so it never exercised the real `makeStdinReader`
  EventEmitter and missed that `setRawMode`/`setEncoding`/`pause`/`resume` were not neutralized. The
  guard now patches the real seeded stdin in place (every consume method throws `NotImplementedError`,
  `'data'`-listener-add gated, `isTTY`/`'end'` passive) and the test runs against a real seeded process.
- **`.bin`/`execSync` children now get `Buffer` + `process.nextTick` ordering** (ADR-0157) — the
  else-branch previously skipped `installRuntimeGlobals`, so a `.bin` tool using `Buffer` threw
  ReferenceError and `process.nextTick` threw TypeError; the gated rich pre-entry install closes the gap.
- **A `node` server that picks the live dev-server port no longer deletes the shared preview route**
  (ADR-0157 review C3). `preview-registry` dedups by port (dev slot wins) and `App.tsx` never wires a
  second SW bridge for the active dev port — previously both the `onDevServer` and node-port paths
  registered the same `/preview/<port>/`, and a teardown of either dropped the other's route (502).
- **`node <file>` natural exit honours `process.exitCode`** (ADR-0157 review D4). A clean return after
  `process.exitCode = N` now exits N (Node uint8 coercion) instead of a hardcoded 0; an uncaught tail
  throw still maps to exit 1 (uncaught wins). `node-program-lifecycle` reads the exit code at the
  drain-then-exit step. (D1: relative `node:fs` reads + `process.cwd()` now agree at a non-`/workspace`
  cwd — the seeded process backs both the loader and `node:fs`/`path`, guarded by a unit at a subdir cwd.)
- **From-scratch preset boots clean over a prior preset's tree — no more EBROKENLOCK** (ADR-0135).
  Selecting a from-scratch vite preset (`real-vite`) after an instant one (`project-files` /
  `node-worker`) installed over the instant preset's baked-snapshot tree: its `package-lock.json`
  omits the boot-overlaid esbuild shim, so the installer's lockfile-coverage check threw
  `EBROKENLOCK` and the dev server stopped (or, on a partial tree, `Cannot find module 'vite'`).
  The owner's preset-switch clean is keyed on `templateId`, so it skipped switches that share one
  (all three presets are `vite`). `ensureProjectDependencies` now clears a foreign `node_modules` +
  lockfile right before the `install()` fallback (reaching it means no stamp matched this slug and
  no snapshot applied → the on-disk tree is another preset's), so a from-scratch install is always
  truly clean — independent of the owner's in-memory switch state, so it holds across a reload too.
- **`stop()` no longer hangs after a post-ready dev-server child crash** (P6b review, ADR-0150). The
  driver's `DevServerHandle.stop()` killed the child then awaited its `'exit'` — but `WorkerHandle.kill()`
  on an ALREADY-exited child returns `false` and emits NO `'exit'`, so a Ctrl-C after a mid-run child
  crash awaited a frame that never came and hung the dev-run (and the controller's `stopped`
  transition) forever. `stop()` now resolves immediately when `kill()` returns `false`, so Ctrl-C
  recovery works; the remaining AUTOMATIC post-ready-exit observation stays the disclosed follow-up
  (`backlog: shell/dev-server-child-exit-unobserved`).
- **Removed the inert `setupPreviewBridge` no-op + dead `ownerToken`/`RIFTY_DEV_SERVER` plumbing from
  the dev-server child** (P6b review, ADR-0150 corrected). `bootDevServer` runs only in the child
  realm, where `setupPreviewBridge` no-ops (`!('serviceWorker' in navigator)`) — the ADR's own
  correction names that placement a forbidden silent no-op. Dropped the call + `dispatchSerializedPreview`
  + `tearDirectSwBridge` and the whole `ownerToken` chain it fed (`RIFTY_PREVIEW_OWNER_TOKEN` env →
  resolver → boot opts) and the never-read `RIFTY_DEV_SERVER` env. The live SW-direct preview route is
  page-anchored (`mountPlaygroundPreviewBridge`); the child serves `/preview/<port>/` via
  `serveCrossRealmPreview` (keyed by port). No behavior change — only dead code removed.
- **Owner flushes its OPFS after the dev-server child's install — shell writes survive reload** (P6b
  regression, ADR-0072/0150; caught by `owner-persistence-reload` e2e). Pre-P6b `bootDevServer` ran in
  the owner, so its `ensureProjectDependencies({ flush: flushSyncMirror })` drained the OWNER's OPFS
  write-through queue. Post-P6b that flush runs in the CHILD, where `syncMirror()` is the remote
  `SyncRpcFsSync` (no `flush` → no-op), while the child's node_modules install writes land in the
  OWNER's write-through queue over fs.* RPC and were never drained. A subsequent small shell write
  (`echo > persist.txt`) queued behind the undrained node_modules backlog and was lost when the reload
  terminated the owner worker before the queue reached durable OPFS. Fix: `DevServerChildBootOpts` gains
  an optional `flush`; the owner driver awaits it on `rifty:dev-ready` BEFORE resolving boot (the
  controller goes LIVE only once the owner store is durable), and `bootShellOwner` passes
  `flush: flushSyncMirror` (owner realm → real OWNER OPFS drain). Boot-scoped (once per dev-server
  boot in the supervisor), NOT the P5-reverted per-`pty:exit` flush stall.
- **Dev-server child binds the preset's dev port, not the owner's spawn default** (P6b, ADR-0150).
  The node-server template entry binds `process.env.PORT`; in the supervised child that env came from
  the owner's spawn-time default (the default vite port 5174), not the active preset's dev port (e.g.
  express-sqlite 3210) — so the entry listened on 5174, the harness `waitForListeningPort(3210)` timed
  out, and `/preview/3210/` 502'd (caught by the `fullstack-demo` gold e2e). The owner's in-realm
  `globalThis.process.env.PORT` mutation does not reach the child entry (it reads its env from the
  clobber-safe `KernelProcessSpec`). `buildDevServerChildSpawnSpec` now sets `PORT`=devPort in the
  child spawn env, the source the entry actually reads. Vite presets are unaffected (vite binds via its
  config port, not `process.env.PORT`).
- **`npm run <script>` no longer silently boots the dev server for non-dev scripts.** The owner's
  `runScript` ignored the script command and always ran the dev server, so `npm run build`
  (`vite build`) exited 0 having silently booted dev. It now boots only for the spec's dev-line
  script NAMES (`dev`/`vite`/`start`, via `isDevScriptName`); any other script loud-rejects to
  stderr + non-zero. Matched by NAME, not command: a preset switch updates the active spec before
  the tree's package.json is re-seeded, so a node preset's `npm run dev` can read a stale `vite`
  command — command-matching wrongly rejected it and broke the node-server boot (fullstack-demo
  e2e). Interim — full node_modules/.bin routing is backlog `shell/node-modules-bin-execution`.
- **Owner death no longer leaves a stale LIVE pill + silently drops edits.** On owner-worker exit
  `realVite` only resolved `closed`, never notifying `onDevServer` listeners — so the UI stayed
  'running'; and a post-exit `writeFile` fell through `worker.send`'s false return into the
  snapshot-port channel, which silently drops with no worker listening. Exit now synthesizes a
  `pty:dev-server` `stopped` frame (UI leaves 'running') and `writeFile` after exit throws loudly
  instead of vanishing.
- **Seeded preset files open EDITABLE despite the publish race.** A just-seeded project file
  opened before the owner snapshot reflected its write classified read-only (sync miss → async
  owner read-port) and stayed so until close+reopen. `openFile` now routes via a pure
  `classifyOpen` helper: a non-node_modules snapshot miss is `await-snapshot` — it subscribes to
  the next `SnapshotFs` publish frame (event, not timer) and opens editable when the file lands.
  node_modules / present-but-over-cap / binary stay view-only exactly as before.
- **Workspace owner boots on the PRODUCTION build (broken deploy, green checks).** In the prod
  bundle a stray top-level `installProcessGlobals()` side-effect (`runtime-js/worker-entry`,
  pulled into the owner chunk + evaluated at module-eval) swapped `globalThis.process` for a
  fresh EMPTY-env one AFTER the kernel pre-entry hook set the spawn env, so the owner read
  undefined worker URLs and threw `missing RIFTY_KERNEL_WORKER_URL / RIFTY_NODE_ENTRY_WORKER_URL`
  → dev server never came up, explorer stuck "Loading the workspace…". `pnpm dev` never loaded
  that module in the owner realm, so the dev e2e stayed green while the deploy was dead.
  `real-vite-bootstrap` now reads its env from the kernel's published process spec
  (`readKernelProcessSpec()`, a dedicated non-enumerable global the swap can't touch) and
  re-asserts it onto the live process. Root cause filed:
  `backlog: runtime-js/worker-entry-process-globals-side-effect`.

### Added

- **Socket Lab preset.** Adds a node-server sandbox template that runs a live
  socket capability matrix: HTTP request body streaming, `ServerResponse`
  drain, `Readable.fromWeb(...).pipe(res)`, npm `ws` over `http.Server`
  upgrade, optional external `ws` egress, and loud ceiling checks for raw
  TCP/UDP/TLS/HTTP2/unbounded cross-realm cases. A dedicated Playwright e2e
  selects the preset and fails CI if the supported probes stop passing or the
  ceiling probes stop failing loudly.

- **Prod-artifact smoke e2e (`playwright.prod.config.ts` + `pnpm test:e2e:prod`, wired into
  CI).** Builds the app and serves it with `pnpm preview` (the Netlify COOP/COEP headers), then
  asserts the workspace owner boots — COI is live, the co-resident dev server reaches `LIVE`, and
  no `missing RIFTY_*_URL` boot error. Closes the green-checks-but-broken-deploy gap: the default
  e2e runs against `pnpm dev`, so a prod-ONLY regression shipped green before.

- **PTY: no more hung terminal on owner death (review #3a).** `pty-client.disconnect()` now
  settles EVERY waiter — in-flight runs resolve nonzero (unchanged), pending `openSession()`
  waiters resolve, and post-death `openSession()`/`exec()` settle immediately — instead of
  leaving the terminal line / Run button hanging forever (it only resolved in-flight runs
  before; reload/tab-close/preset-switch/owner-crash fire `disconnect()`).
- **PTY: `exec` on an unknown session emits `pty:exit{error}` (review #3b).** The owner handler
  silently `return`ed on a missing session, hanging the page run; it now emits a synthetic
  error-exit so a protocol-order violation surfaces loud.

### Removed

- **Dropped the wired-no-op `pty:resize` frame (review #3c).** Live terminal resize was
  advertised (`PtyClient.resize`, `WorkspaceOwnerHandle.resize`, `PtyResize` frame) but the
  owner silently ignored it (and nothing on the page called it). Removed the whole chain rather
  than keep advertising an unimplemented capability; dims stay per-exec. Real live-resize →
  `backlog: shell/pty-live-resize`. With #3b this closes + retires
  `backlog: shell/pty-server-protocol-honesty`.

### Changed

- **`FileExplorer` is a pure read-only viewer (review #4).** The page never mutates the owner
  store directly (`snapshotFs` throws on write; owner = SSoT, ADR-0148/0150), so the explorer's
  disabled create/rename/delete machinery — wired to the throwing snapshot — is removed rather
  than left hidden behind a `readOnly` prop. Create/rename/delete happen via the editor or
  terminal (routed to the owner) and reflect on the next poll. Owner-routed in-tree CRUD →
  `backlog: playground/owner-routed-explorer-crud`.

- **The page holds no authoritative VFS store — the owner is the single store
  owner (D-acceptance A1/A2; `d-owner-worker-milestone`).** P4 left a SECOND
  authoritative `syncMirror` on the PAGE (`initBackend`) written-through as a
  workspace-archive copy, so the archive diverged from owner-side (shell/CLI)
  writes and the "one store owner" invariant held only `partial`. Now retired:
  workspace archive export/import is owner-served (`glue/workspace-archive-port`,
  reusing the realm-agnostic `glue/workspace-archive` against the owner
  `syncMirror` — full content, no 128 KB cap, so a downloaded archive includes
  shell/CLI-authored files); seeding + the default README are owner-only
  (`real-vite-bootstrap` `seedProject`); the persisted terminal cwd is validated
  in the owner (`glue/reachable-cwd` in `makeShell`) instead of against the page
  store; and the storage badge reads `detectVfsBackend` (the page installs no
  backend — this also fixes the prior page-main-thread "OPFS-sync-fails → badge
  shows memory" misreport). Authoritative-store count == 1; A1/A2 hold. Tests:
  `glue/workspace-archive-port.test.ts`, `glue/reachable-cwd.test.ts`; e2e
  `owner-*` + `sandbox-fs-rpc` green.

### Tests

- **Single-store-owner behavioral acceptance — the cross-realm cases parity
  can't reach.** Four new owner e2e specs:
  `owner-editor-write-exec-read` (a page editor write is read back by exec in the
  owner — no stale page store shadows it), `owner-single-source-byte-identity`
  (the same file reads identical from the page viewer `SnapshotFs` and from
  `cat`), `owner-snapshot-restore-exec` (install + write → reload → the installed
  CLI still runs + the file still reads — the spec that caught the reload-persist
  bug above), and `owner-responsive-under-load` (the page main thread stays
  responsive during the co-resident dev-server boot). Byte-identity is scoped to
  in-cap files; over-cap files report an honest "too large to preview", already
  unit-asserted in `glue/snapshot-fs.test.ts` (the viewer never shows WRONG
  bytes). All owner/COI specs now carry a `test.skip(browserName!=='chromium')`
  guard so the firefox/webkit projects skip them instead of failing.

### Fixed

- **A user `npm install` now survives a reload — an installed CLI still runs
  after teardown/restore.** Two coupled bugs dropped the user's install on every
  reload: (1) the shell `npm` stamped the tree with slug `''` instead of the
  owner's project slug, so the boot's `installStampSatisfied(slug)` missed and
  the dependency arrival re-ran; (2) `bootDevServer` force-overwrote
  `package.json` with the template default on every boot, reverting the user's
  added deps — which then failed the stamp's dep check and restored the baked
  snapshot, REPLACING `node_modules` (the install was already OPFS-persisted, but
  got clobbered on boot). Now the shell `npm` stamps with the current project
  slug (`npm-shell-command` `projectSlug`), and `bootDevServer` seeds
  `package.json` if-absent (a genuine preset switch resets it in the `boot`
  closure alongside the node_modules/lockfile clear). A same-template reload
  reuses the persisted tree (stamp no-op). Caught by `owner-snapshot-restore-exec`
  e2e; unit-guarded in `npm-shell-command.test.ts`.

- **Honest module HMR for real-Vite previews (ADR-0145, superseded transport by
  ADR-0151).** Real-Vite no longer turns every edit into a hand-rolled
  `{type:'update', path}` plus `location.reload()`. Vite now keeps its native
  `server.ws` path, attaches to rifty `http.Server.on('upgrade')`, and generates
  real HMR payloads (`update.updates[]`, `full-reload`, `prune`, `error`). The
  injected iframe script installs the generic `@riftydev/net` browser
  `WebSocket` bridge, so Vite's own `@vite/client` patches self-accepting
  modules in place without a Vite-only socket shim. The seeded Vite entry is
  self-accepting, and editor writes wake Vite's native watcher path instead of
  manually broadcasting a fake update.
  Tests: `apps/playground/src/glue/hmr-bridge.test.ts`,
  `apps/playground/src/workers/real-vite-bootstrap.test.ts`,
  `apps/playground/src/workers/real-vite-invalidation.test.ts`,
  `apps/playground/src/templates/project-spec.test.ts`,
  `tests/integration/vite-hmr-channel.test.ts`, opt-in browser
  `tests/e2e/m10-hmr.spec.ts`, and opt-in manual install browser
  `tests/e2e/manual-vite-install.spec.ts`.

- **Editable project files in real-vite mode (ADR-0076 §Decision-4, corrected).**
  Editing a seeded source tab (e.g. `src/project-summary.js`) while the dev
  server ran threw `writeFileSync: "…" is read-only — it lives in the Vite
  worker realm`: the editor wrote through `activeVfs()`, which flips to the
  read-only worker `SnapshotFs` once Vite boots, and a tab opened before the
  flip kept a stale write path. The editor now splits its READ view (the
  snapshot) from its WRITE target (the always-writable page `syncMirror()`, new
  `EditorHost` `writeVfs` prop + `glue/editor-write-router.ts`): a file is
  editable iff the page mirror owns it, and the edit rides the existing
  `onFileWritten` → `syncWorkspaceFileToWorker` → write port (ADR-0043) to the
  worker (Vite watcher → HMR). Worker-only files (`node_modules`,
  worker-generated) stay read-only. ADR-0076's original view-only-for-file-tabs
  decision was wrong (a read-only sandbox is nonsense) and is corrected in place;
  its snapshot bridge is unchanged. Regression test: `glue/editor-write-router.test.ts`.

- **Writable file explorer in real-vite mode (ADR-0076 §Decision-6).** The
  explorer showed a `read-only` badge and hid new/rename/delete while editing
  worked — inconsistent. It now uses `glue/real-vite-explorer-vfs.ts`
  (`RealViteExplorerVfs`): reads the worker snapshot, writes the page mirror, and
  propagates each op to the worker over the write port — which gains an `rm`
  frame (delete + rename) alongside `write`/`mkdir`, pushed via
  `RealViteHandle.applyVfsFrame`. `node_modules` rows stay read-only. Badge gone,
  CRUD controls shown. Tests: `glue/real-vite-explorer-vfs.test.ts`,
  `glue/vfs-write-port.test.ts` (rm frame).

- **No white flash on preview full-reload fallbacks.** Vite still full-reloads
  for HTML/config/non-accepted boundaries; the worker-seeded `index.html` had no
  background, so entry code that sets `body` bg via JS flashed white between
  reload and module-eval. `buildIndexHtml` now seeds
  `<style>html,body{margin:0;background:#101218}</style>` so the document paints
  dark from the first frame. Test: `templates/project-spec.test.ts`.

### Added

- **Foreground CLIs run in a supervised child worker (P6a of ADR-0150).** Each
  shell-resolved `.bin`/node CLI now runs in a child worker-process the owner
  SUPERVISES — resolution stays owner-side, the child reads+writes the owner store
  over `fs.*` sync-RPC (`RIFTY_REMOTE_FS=1`) instead of running in-realm — so the
  owner stays a free async supervisor while a CLI runs (ADR-0150 `waitAsync`
  invariant). `createOwnerChildBinExecutor` (over `globalProcessManager.spawnWorker`)
  replaces the in-realm `createOwnerBinExecutor` at the frozen `BinExecutor` seam
  (ADR-0137); the owner registers the `fs.*` handlers + receives the kernel +
  node-entry worker URLs via env (recursive spawn). New e2e
  `owner-shell-responsive`: two terminals' children run concurrently + Ctrl-C kills
  a running child; `owner-shell-cowsay` now exercises the child path. (P6b — the
  dev server → child — is the remaining D phase.)

- **OPFS persistence in the workspace owner (P5 of ADR-0143 "D").** The owner now
  `await initBackend()` at boot like every other worker realm
  (`runtime-js/worker-entry`, `rifty/sandbox`) — it was the only realm left on
  memory, so the workspace (installed `node_modules`, edited + shell-written files)
  vanished on `page.reload()`. The OPFS content-cache write-through (ADR-0072) is
  the durability mechanism on its own; there is no per-command flush barrier — an
  awaited drain coupled command latency to the unrelated boot write-through queue,
  stalling the shell during boot (graceful drain-on-terminate →
  `docs/backlog/shell/owner-graceful-drain-on-terminate`). New e2e
  `owner-persistence-reload`: `echo > /workspace/persist.txt` → `page.reload()` →
  `cat` survives (honest — fails on the memory backend).

- **Unified workspace owner: co-resident dev-server + single source of truth
  (ADR-0148, P4 of ADR-0143 "D").** The `vite`/dev server now runs CO-RESIDENT
  inside the ONE persistent workspace owner — started on demand by the owner's
  `vite` / `npm run <script>` shell command, stopped on Ctrl-C via `server.close()`
  without killing the owner — so it reads the SAME store `npm install` writes
  (closes the two-owners trap: `npm install <pkg>` then `npm run dev` share
  `node_modules`). The per-run `startRealVite` preview worker and the entire
  page-driven dev path (`dispatchDevServerLine`/`runViteCommand`/`isDevServerLine`)
  are deleted; dev-server start/stop + the listen port flow to the page over a new
  structured `pty:dev-server` frame + the P3 request handshake (no stdout
  log-match). The owner becomes the SINGLE SOURCE OF TRUTH: the editor + explorer
  always read the owner snapshot (the `activeVfs`/`snapshotFs` `vite`-gated swap is
  retired), editor + program edits write to the owner (HMR against the same store
  it serves), and the `node_modules` read-port is widened to a general workspace
  read-port whose consumer is the editor opening owner-only files. New
  `dev-server-controller` (single-active guard + dev-server frame emit + HMR
  forward); `wirePreviewBridge` replaces the per-run page preview wiring. COI e2e:
  co-resident vite preview through the SW (`m7-preview-sw`), node-server
  (`fullstack-demo`), shell CLI (`owner-shell-cowsay`), explorer coherence
  (`owner-explorer-coherence`).

- **Owner snapshot coherence + readiness handshake (ADR-0146, P3 of ADR-0143
  "D").** The page file explorer now reflects files the owner-resident shell
  writes: the owner republishes its `syncMirror` snapshot on every command exit
  (`pty:exit`), so a bare `echo > f` / a program's output shows up without a
  dev-server restart (e2e `owner-explorer-coherence.spec.ts`). The blind
  owner-side snapshot retry-storm (`[300,1200,3000]ms` re-publish) is replaced by
  a structured handshake: the page posts `snapshot-req` on subscribe and the
  owner replies via `serveSnapshotRequests`, so the initial sync is deterministic
  whichever side comes up first (and survives page reload). Deferred to P4: the
  general (non-`node_modules`) on-demand read-port widening — it needs an editor
  consumer for large/owner-only files and lands when the preview owner unifies.
- **Owner-resident shell + pty channel (ADR-0146, P2 of ADR-0143 "D").** The
  `Shell`, cwd/env, `npm install`, and bin/`execSync` now run inside ONE
  persistent workspace-owner worker (the real-vite bootstrap generalized to a
  mode-parametrized `shell`|`preview` owner, spawned `serve:true` at App-mount,
  addressed by a stable `workspaceId`); the PAGE terminal is a thin client over a
  `pty:*` frame channel on the kernel fork-IPC port (control AND stdout/stderr
  chunks on one ordered channel, `sessionId`+`runId` correlated, cwd/env pushed
  on `pty:exit`, structured `pty:ready` handshake). npm + bin share the owner's
  `syncMirror`, so an installed CLI (`cowsay hi`) finally runs end-to-end —
  closes the ADR-0143 ENOENT dead link. New `pty-protocol`/`pty-server`/
  `pty-client`/`owner-bin-executor`; `terminal-manager` is now a pty port client;
  the dead `useShellSession` adapter is removed. Persisted cwd/env restore via the
  `pty:open` seed; `npm run <dev>` routing stays page-driven. COI e2e
  `owner-shell-cowsay.spec.ts` (CI-only). The dev-server preview owner stays
  separate (page-driven) until **P4** folds it into this owner — a tracked
  two-owners transient (no residual debt at D close).
- **Wire installed-CLI execution to the node-entry loader bootstrap (ADR-0137,
  Opt-Y).** `createBinExecutor` spawns the `kind:'url'` node-entry bootstrap
  (`workers/node-entry-bootstrap.ts`) for a shell-resolved `node_modules/.bin/<name>`
  shim; in the worker it reads the shim, resolves its launcher target, and runs
  THAT through the module loader (shebang stripped, relative imports resolved vs
  VFS) — streams stdout/stderr to the terminal, `ctx.signal` (Ctrl+C) kills it.
  Wired via `createTerminalManager({ execBin })`; `main.tsx` injects the bootstrap
  URL for runtime-js (`setNodeEntryWorkerUrl`). SAB-IPC-gated. Registered commands
  (`vite`) still win. Replaces the earlier `kind:'source'` approach, which threw
  on the shim's shebang (ADR-0137 §Rejected).
  - The execution MECHANISM (`runNodeEntry` + loader) is proven by node unit
    tests + parity. NOT YET working end-to-end in the browser: the spawned bin
    worker's `syncMirror` is a separate in-worker realm that does not yet hold
    the installed `node_modules` (after ADR-0135 `install()` runs in the
    worker/OPFS realm) — a real CLI `ENOENT`s on its shim. Tracked in
    `docs/backlog/shell/node-modules-bin-execution.md`.

- **Baked node_modules snapshots — instant presets are instant on the FIRST
  boot too (ADR-0135 item 6).** `pnpm snapshots:bake` runs a real `install()`
  per baked template and ships node_modules + lockfile as a committed gzipped
  asset (`public/snapshots/`, vite ≈9 MB gz). The worker's dependency arrival
  (`glue/project-deps.ts`) is now stamp → snapshot → install: a stampless boot
  restores the baked tree (deps-equality gated, REPLACE semantics, then
  stamped) instead of resolving/fetching; any snapshot failure falls back to a
  real install. Gzip is sniffed by magic bytes (vite dev pre-decodes `.gz` via
  Content-Encoding; static hosts serve raw bytes). Regeneration policy:
  `docs/backlog/playground/baked-snapshot-regeneration.md`.

- **Sandbox setup kinds: instant vs from-scratch (ADR-0135).** Presets carry
  `setup: 'instant' | 'from-scratch'`. BOTH kinds boot the template's dev line;
  the difference lives in the WORKER realm (carried over `RIFTY_RFV_SETUP`).
  From-scratch presets (`real-vite`, `express-sqlite`) run a VISIBLE, honest
  `install()` inside the worker — the realm that owns the OPFS tree the preview
  is served from — skipping the baked snapshot and streaming live
  `npm: + <name>@<version>` per-package output (ADR-0134) before the dev server
  starts. Instant presets (`project-files`, `node-worker`) take the quiet
  snapshot/stamp path. Node_modules reuse is keyed on the **project slug**
  (preset id, `node_modules/.rifty-install-stamp.json` in OPFS), not the deps:
  `project-files` and `real-vite` both run `vite` but must not reuse each
  other's tree, so a from-scratch preset always shows its install even when an
  instant preset already warmed OPFS — re-selecting the same project reuses
  (fast). Switching projects clears the terminal first. Template switcher groups
  presets under "Instant start" / "From scratch" with kind pills. Stamp
  invalidation is provisional —
  `docs/backlog/playground/install-stamp-invalidation.md`.

### Changed

- **Production npm registry proxy moved to Yandex Cloud (ADR-0161).** Netlify
  now deploys only the static playground artifact; production builds set
  `VITE_RIFTY_REGISTRY_URL=https://registry.rifty.dev/npm-registry`, and
  tarball URL rewriting uses that configured proxy origin. The old Netlify
  Function source and `/npm-registry` redirects are removed; CI smoke tests the
  Yandex Cloud streaming proxy directly.

- **Mono font → JetBrains Mono.** Code surfaces (Monaco editor, xterm terminal,
  code chips, seeded sandbox preview CSS, `--rf-font-mono`) now use self-hosted
  JetBrains Mono (OFL, variable woff2, latin + cyrillic subsets) in place of
  Roboto Mono; `index.html` preload and `public/fonts/LICENSE.md` updated,
  Roboto Mono woff2 removed. Editor, terminal, and sandbox preview templates
  share a single `glue/fonts.ts` `MONO_FONT_STACK` constant.

- **JetBrains Mono throughout the playground (ADR-0140).** Playground chrome now
  points `--rf-font-sans` at the same JetBrains Mono stack as code surfaces, and
  critical `index.html` styles preload/use JetBrains Mono instead of Inter.

- **Netlify deploy automation.** GitHub Actions now deploys `main` to the
  production site and same-repo PRs to stable `pr-<number>` preview aliases;
  `netlify/functions/npm-registry.mts` carries the npm-registry proxy while
  `public/_redirects` keeps the SPA fallback in the built artifact.

- **ADR-0126 records the preview reload policy.** Preview iframe reloads are
  HMR-client-driven; the snapshot-driven `previewRevision`/`refreshKey` reload
  removed in the preview-routing branch is now ADR-recorded (options,
  rationale, stale-iframe trade-off). Docs/comments only; no behavior change.

- **"Soft Panels" visual redesign (ADR-0124).** UI rebuilt to the Gravity-UI
  design handoff: rounded card panels (`#1D1F26`) with 12px gaps on a
  `#131419` page, rifty lime `#C7F05A` accent, originally Inter (UI) + Roboto
  Mono (code/terminal), now superseded by ADR-0140's single JetBrains Mono
  stack. Top bar now
  hosts the template switcher (dropdown; replaces the activity bar + sidebar
  gallery, same e2e selectors), a LIVE/STARTING/STOPPED status pill, a ⌘K
  command bar, a GitHub link, and a Share button (copies the URL, success
  toast). Preview pane gained browser-frame chrome (address bar with editable
  port, phase pill, reload / open-in-tab). Monaco and xterm re-themed to the
  panel surface with handoff syntax colors; splitters now live invisibly in
  the panel gaps. Layout defaults follow the mockup, with later feedback
  widening preview and raising the terminal.

- **Default preview pane is wider.** Fresh layout state now starts the browser
  preview at 560px instead of the original Soft Panels 464px.

### Fixed

- **Terminal history/state saves serialized (P5 of ADR-0143 "D").** The page
  persists best-effort (`void saveHistory(...)`) per command; under the now
  OPFS-backed owner's write-through I/O the fire-and-forget OPFS writes could
  reorder — an earlier full-array write landing after a later one and dropping the
  most recent command (`terminal-persistence … OPFS after reload` flaked).
  `createTerminalPersistence` now queues writes onto one tail so the latest save
  wins. The reload e2e also waits for a command to finish before typing the next
  (a command typed while the previous runs lands in its stdin — correct terminal
  semantics the OPFS-slowed owner boot exposed; owner boot responsiveness → P6).

- **P2 owner regressions caught only by CI e2e (ADR-0146).** Four baseline
  chromium specs broke under the owner-resident shell and are green again:
  (1) a fork-IPC message-drop race (fixed in `runtime-js`) hung EVERY shell
  command with no output — `pty:open` was posted before the slow owner bootstrap
  registered its `process.on('message')`; (2) preset files (`src/project-summary.js`
  …) reached only the preview worker, so the owner shell `cat`'d ENOENT —
  `seedViteWorkspace` now pushes them to the owner via the new
  `WorkspaceOwnerHandle.writeFile` (a `rifty:vfs-write` frame); (3) the
  PAGE-driven dev-server tab showed `data-running=false` (its session never runs
  through `manager.runLine`) — the tabs now reflect `devServerRunning` for the
  owning session; (4) the cowsay e2e matched the mid-stream `+ cowsay@` and typed
  `cowsay hi` into the still-running install (keystrokes → npm stdin), so it never
  ran — it now waits for the install-complete summary. These slipped past local
  green because the owner path is cross-origin-isolation-gated (CI-only).

- **Seeded sandbox previews now use JetBrains Mono.** The playground chrome,
  Monaco, and xterm had already switched, but the project preview templates
  still carried Roboto/system monospace literals.

- **Netlify npm registry proxy deploy (ADR-0133, supersedes ADR-0028).** CI and
  one-off Netlify deploy docs now run `netlify build` before artifact deploys
  so the function bundle and metadata stay in Netlify's build state; checked-in
  redirects now route `/npm-registry/*` to the production proxy before the SPA
  fallback. The function also falls back to
  `process.env.RIFTY_NPM_REGISTRY_UPSTREAM`, and deploys smoke-test
  `/npm-registry/vite` metadata plus its latest tarball on the live URL.

- **Real Vite worker registers net/sqlite builtins through explicit calls.**
  Production bundling could drop side-effect-only imports and make Vite fail on
  `Built-in 'node:http' is not implemented`; the bootstrap now calls the
  idempotent `@riftydev/net` registrars directly.

### Added

- **Storage persistence + workspace archive.** Playground boot now probes
  `navigator.storage.persisted()` / `persist()` / `estimate()`, threads the
  result into the status badge, and exposes command-palette actions to
  download/import a dependency-free JSON workspace archive that excludes
  derived/heavy directories (`node_modules`, `.git`, `.vite`, `dist`).
- **Production npm registry proxy source.** Netlify routes `/npm-registry/*`
  to `netlify/functions/npm-registry.mts`, preserving metadata/tarball paths
  and adding CORS/CORP headers so the cross-origin isolated playground can use
  the same `/npm-registry` base outside dev.
- **Global command palette (⌘K / Ctrl-K).** Searches project templates,
  workspace files, and shell actions (new terminal, toggle terminal/files
  panels, open preview tab, stop dev server, copy share link). Modal dialog
  semantics with a focus trap, document-level Escape, focus restore on close,
  and keep-in-view arrow navigation. The hotkey is capture-phase and matches
  the physical key, so it works with Monaco/xterm focus and on non-Latin
  keyboard layouts.
- **Express + SQLite fullstack demo template (ADR-0130).** Second runnable
  project template (`node-server` runtime): real `express@4` installed from
  npm inside the worker, static client served from the VFS via
  `express.static`, `node:sqlite` (DatabaseSync over the sql.js WASM engine)
  as the database. New "Express + SQLite" preset in the gallery; covered by
  `tests/e2e/fullstack-demo.spec.ts` plus the opt-in
  `tests/integration/fullstack-demo-live-run.opt-in.test.ts`.
- **`ProjectSpec` is a discriminated union** (`vite` | `node-server`); the
  worker bootstrap dispatches on it — node servers run the ENTRY itself (cwd
  at project root, loud no-listen failure); HMR bridge + esbuild/rollup shims
  stay vite-only. sqlite engine bring-up uses an explicit `wasmBinary` +
  pinned `locateFile` from the bundled same-origin asset.
- **`RIFTY_PLAYGROUND_PORT` env** overrides the dev/e2e port (vite +
  playwright configs) so parallel git worktrees run side by side.

### Changed (migration)

- **Layout persistence key bumped to `rf.layout.v2`.** Old v1 sizes fit the
  pre-redesign shell, and a stale `sidebarCollapsed=true` from the removed
  activity bar would have hidden the files panel with no recovery UI; v1
  state is orphaned and defaults apply on first load.

### Changed (2026-06-11 design feedback)

- **Terminal Stop button removed.** Server state shows in the status pills;
  stopping goes through Ctrl-C in the terminal or the ⌘K palette ("Stop dev
  server"). Matches the handoff, which dropped the button.
- **Default terminal height raised to 280px** (mockup's 212px was too shallow
  for real logs).
- **Preview address copies the real URL.** The shown `localhost:<port>` host
  is virtual; clicking the address copies this origin's SW-routed
  `/preview/<port>/` URL with a toast. The URL serves only tabs the
  playground opens itself (`↗` button) — SW routing scopes a port to its
  owner window (backlog: `service-worker/cross-tab-preview-routing`).

### Fixed

- **Command palette opened pinned to the top-left corner.** `<dialog>` UA
  positioning (absolute + auto margins) escaped the flex centering; the panel
  is now statically positioned inside the scrim.
- **Editor code no longer collides with the right-edge ruler strip.** The
  overview ruler is disabled (minimap already off).
- **Terminal no longer flips to a light theme on light-OS machines.** The
  shell is dark-only; both `prefers-color-scheme` branches now resolve to the
  panel-surface xterm theme.
- **Undefined CSS variables in terminal overlays.** `--rf-ok` and
  `--rf-shadow-2` were referenced but never defined (block-rail / history
  exit-status colors and overlay shadows silently fell back); the token set
  now defines `--rf-ok` and real shadow tokens.
- **Real Vite editor writes are now checked through the real Monaco path.** The
  HMR e2e no longer uses a production-only source setter; it focuses Monaco's
  input, edits the visible model, then waits for the worker-applied write, an
  actual iframe HMR bridge `update` event, and the iframe update. The parent
  preview panel no longer reloads the iframe for every worker VFS snapshot, so
  the e2e cannot pass via explorer refresh alone.
- **Real Vite HMR invalidates by Vite file-change semantics.** Worker-side
  writes now call `moduleGraph.onFileChange(file)` instead of probing
  `getModuleById(file)` and falling back to `invalidateAll()`.
- **HMR bridge channels are per-server tokenized.** The iframe client and bridge
  server share a nonce-scoped URL/channel, so unrelated same-origin code cannot
  join the old predictable port-only HMR channel.
- **Cross-origin isolation failures now explain embedded-browser requirements.**
  The fatal COI guard still refuses to boot without `crossOriginIsolated === true`,
  but the message now calls out iframe/app-browser embeds: the parent page must
  also be cross-origin isolated and the iframe must include
  `allow="cross-origin-isolated"`.
- **`preset.templateId` wired (ADR-0130).** App follows the selected preset's
  template (reactive `activeTemplate()`) instead of always booting the
  registry default; boot line is template-dispatched (`terminalDevLine`:
  `vite` | `npm run dev`), `npm run dev` routes the template's dev script to
  the lifecycle-owning dev-server command, `vite` refuses non-vite templates
  with a hint; spawn env gains Node-idiomatic `PORT`.
- **sql.js pre-bundled** (`optimizeDeps.include`) — lazy CJS discovery from
  the worker chunk made dev Vite re-optimize and full-reload the page
  mid-session, dropping the selected preset and running dev server.
- **Project presets now open starter editor tabs.** File-oriented presets open
  two seeded files beside `src/main.js` as inactive tabs, so users see the tab
  strip immediately while the entry file remains active.
- **Terminal tabs now keep the add button attached to the tab strip.** The
  bottom-console tab list no longer stretches across the whole toolbar before
  the `+` action, so the new-terminal control stays visually glued to the
  terminal tabs while remaining visible when the tab list overflows.
- **Terminal tab switching is regression-covered end-to-end.** Playwright now
  switches Terminal 2 → Terminal 1 → Terminal 2 and asserts the active buffer
  changes with the selected tab.
- **Idle terminal tabs close cleanly.** Closing a newly created terminal no
  longer lets an xterm WebGL teardown exception interrupt Solid's DOM update;
  the console returns to the running terminal with a single active panel.
- **`npm run vite` works in the playground shell.** The seeded Vite project now
  exposes both `dev` and `vite` scripts, and the playground `npm run <script>`
  path routes `vite` scripts through the same visible terminal command that owns
  the real Vite worker lifecycle.
- **Ctrl+C now reaches the shell through the bottom console.** `BottomPanel`
  declared `onSignal` but dropped it before `TerminalPanel`, so the terminal
  echoed `^C` while the playground shell never received `interrupt()`. The
  prop is now forwarded to the mounted xterm wrapper.
- **Terminal command status now reaches xterm markers.** Shell-mode `runLine()`
  returns its exit code through `BottomPanel`/`TerminalPanel` into
  `RiftyTerminal`, so command blocks can show success/failure decorations.
- **Terminal tab completion is wired in shell modes.** The playground now feeds
  `RiftyTerminal` completions from `Shell.commandNames()` at argv-0 and from the
  main-thread VFS for path arguments.
- **Terminal follows OS light/dark preference.** The xterm wrapper now starts
  with a terminal theme derived from `prefers-color-scheme` and updates it via
  `setTheme()` on OS theme changes. The broader playground CSS light theme
  remains its parked backlog item.
- **Terminal find overlay.** Ctrl/Cmd+F inside the console opens a compact find
  box backed by `RiftyTerminal.findNext()` / `findPrevious()`; Enter and
  Shift+Enter walk matches, Esc closes and clears decorations.
- **Terminal command palette.** Ctrl/Cmd+Shift+P inside the console opens a
  command picker seeded from `Shell.commandNames()`; selecting a command
  pre-fills the terminal through `RiftyTerminal.replaceLine()`.
- **Terminal quick fix for command typos.** Shell stderr `Did you mean 'cmd'?`
  diagnostics now surface a console action that runs the suggested command via
  `RiftyTerminal.submitLine()`.
- **Terminal quick fixes are provider-based.** The quick-fix glue now supports
  multiple output providers; `EADDRINUSE` / address-in-use diagnostics offer a
  stop-and-rerun action for the last submitted command.
- **Terminal sticky command header.** The console now pins the command block at
  the top of the xterm viewport and lets you click it to jump back to that
  command.
- **Terminal command-block rail.** Recent command blocks now show as a compact
  status rail in the console; clicking a mark jumps to that block, and the
  sticky command header has an icon action to copy the current block output.
- **Terminal rich history overlay.** Ctrl/Cmd+R inside the console opens a DOM
  history picker backed by rich records (command, cwd, mode, duration, exit
  code, session id) saved through the terminal persistence store; selecting a
  row restores the command line.
- **Terminal state persistence.** The playground now restores shell `cwd` and
  env from `/workspace/.rifty/terminal-state.json` before constructing the shell
  session, then saves updated state after each submitted terminal line. Async
  OPFS is used when available; memory fallback remains session-only.
- **Shell abbreviations/snippets.** Shell-mode terminal input now seeds
  fish-style rewrite rules for `ll -> ls -la`, `la -> ls -a`, and
  `mk -> mkdir -p`.
- **AI command suggestions.** When `VITE_RIFTY_AI_COMMAND_SUGGEST_URL` is set,
  shell-mode `# prompt` lines request a command suggestion, render it as ghost
  text, and accept it by replacement only. Suggestions are filtered to rifty
  coreutils, reject compound shell syntax, and never auto-run; raw `# prompt`
  Enter is a no-op.
- **Background jobs.** Shell-mode `cmd &` now returns the prompt immediately,
  streams background output into the terminal without corrupting the editable
  line, and exposes status through the `jobs` builtin.
- **Terminal raw stdin.** Shell-mode foreground commands now receive terminal
  raw input while running, enabling `mouse-demo` to verify xterm mouse reports
  through the browser.
- **Terminal e2e renderer.** Automated browsers disable the WebGL addon via
  `navigator.webdriver`, keeping xterm's DOM rows available for Playwright
  assertions while normal sessions keep best-effort WebGL.
- **Terminal output export.** The terminal command palette now includes actions
  to copy text output, copy HTML output, and download the serialized scrollback
  as a standalone HTML document.
- **Terminal OSC 8 file links.** Ctrl/Cmd-clicking a `grep` file hyperlink opens
  safe `file:///workspace/...` targets in the editor; non-file, outside-workspace,
  and traversal links are ignored.
- **Shell command-line syntax highlighting.** Shell-mode terminal input now
  colors command words, quoted strings, and shell operators through the
  `@riftydev/terminal` highlighter seam.
- **Shell multiline input.** Shell-mode Enter now keeps editing when quotes,
  bracket groups, or trailing continuations are incomplete; the completed raw
  multiline buffer is submitted as one command.
- **Terminal autocomplete dropdown.** Tab or Ctrl/Cmd+Space inside the console now
  opens a keyboardable DOM completion list backed by the existing shell
  command/path completer; ArrowUp/Down selects, Enter/Tab applies, Esc closes.
- **Real Vite browser e2e covers the full opt-in path.** The `RIFTY_E2E_HMR=1`
  Playwright flow now drives the cross-origin-isolated path: boot Vite in the
  worker realm, render the iframe through SW preview routing, edit `src/main.js`
  through Monaco, write it into the worker VFS, invalidate Vite's module graph,
  and reload the iframe through the cross-realm HMR bridge. The backlog stays
  open until this path has a default or CI verification lane.
- **Terminal no longer overlaps the status bar.** xterm's `FitAddon` computes
  rows from the mount element's height minus *that element's own* padding (the
  `.xterm` div it creates, padding 0) — so the `6px` vertical padding on the
  `.rf-terminal` mount container was never subtracted and the bottom row
  overflowed ~6px past the console body into the status bar. Moved the gap from
  `padding` to `inset` on `.rf-terminal` (+ `--rf-bg-1` on `.rf-console__body`
  so the inset gap stays the xterm surface colour); FitAddon now fits the
  trimmed box. Verified live: 9px clearance above the status bar.
- **Dev-mode preview is now live (HMR auto-reload).** Editing a file in dev
  mode left the preview frozen until a manual page reload: the mini dev server
  (`examples/vite-like-dev`) broadcast HMR over an in-process `WebSocketServer`
  that the preview iframe — a separate realm reached via the SW — can never
  reach. Dev mode now routes HMR through the same cross-realm `BroadcastChannel`
  bridge real-Vite uses: the example dev server gained a pluggable `hmr`
  transport, and `startDevMode` wires `setupHmrBridge` + injects
  `hmrClientScript` into served HTML. Closes the dev-vs-real-Vite HMR asymmetry.
  Verified live: editor edit → watcher → bridge → iframe auto-reloads with the
  new content.
- **Rich-terminal capabilities were dead in the real app — now wired.** The shell
  adapter forwarded none of `isTTY`/`cols`/`rows`/`signal`, so `ls` column layout +
  `--color` never engaged and Ctrl+C never reached the shell. `useShellSession.runLine`
  now passes `isTTY:true` + live `cols`/`rows` (from xterm via `RiftyTerminal`) + a
  per-run `AbortController`; new `interrupt()` is wired to the terminal's `onSignal`
  (Ctrl+C → SIGINT → a running `sleep`/dev-server winds down, exit 130). Threaded
  `onSignal` + dimensions through `BottomPanel`/`TerminalPanel`/`App`. Review pass 2026-06-07.

- **Real Vite preview now renders (and shows progress) instead of looking
  frozen (ADR-0077).** Three stacked breaks fixed: (1) `installProcessGlobals()`
  in the real-vite worker clobbered the kernel-wired `process.stdout`/`stderr`
  with `console.*`, so all install/boot logs — and error stacks — vanished
  (preserve the kernel stdio + env across the swap); (2) the kernel tore the
  worker realm down the instant `bootstrap()` resolved (`self.close()` on entry
  return), killing the Vite dev server right after it started listening → every
  preview request hit a dead worker (`502 bridge-timeout`) — the bootstrap now
  stays alive until `.kill()`; (3) the SW routed the iframe navigation to the
  wrong client (ported ADR-0074). Plus `PreviewPanel` warm-up now uses a
  per-probe `AbortController` + a 90 s budget so it spans an npm install and
  auto-loads to `live` (~22 s) without a manual Reload. Verified live:
  `/preview/<port>/` 200s, the iframe commits and renders the Vite app.
- **Real Vite preview now owns its Service Worker route directly (ADR-0123).**
  The Real Vite page and Worker share a preview `ownerToken`; the Worker mounts
  `setupPreviewBridge(..., { ownerToken, ports: [port] })`, so the SW can route
  `/preview/<port>/...` straight to the matching Worker-owned Vite server. The
  page-side cross-realm preview proxy remains as a compatibility fallback for
  legacy window-owned paths and old-SW/new-page skew.
- **Dev-server console noise removed.** A custom Vite logger filters the
  harmless `Failed to load source map … marked.umd.js.map` warning (monaco 0.52
  ships `marked.umd.js` with a dangling sourcemap ref); dev-only, no runtime
  effect.
- **Console now scrolls.** `xterm.css` was linked from `index.html` as
  `/@xterm/xterm/css/xterm.css`, a path Vite never serves (it resolved to the
  SPA-fallback HTML in dev *and* prod), so xterm rendered without its
  stylesheet — `.xterm-viewport` had `overflow-y: visible` and zero height and
  the terminal could not scroll. Now imported from `main.tsx` (`@xterm/xterm`
  added as a direct dep) so Vite bundles it in dev and prod.

### Changed

- **Generic ProjectSpec/Template runtime — Vite is now just the default template
  (ADR-0078).** The "Real Vite" mode no longer hardcodes Vite across five files;
  a new playground-internal `ProjectSpec` value object (install deps, import
  specifier, createServer knobs, entry, seed files) drives the worker bootstrap,
  the orchestrator, and the mode machine via a new `RIFTY_RFV_TEMPLATE` env var.
  Adding a second runnable template is now a data change (a `ProjectSpec` + a
  preset row with a `templateId`) rather than a worker fork. The pure
  `resolveBootstrapConfig` mapping (incl. index.html-script-src derived from the
  entry) is unit-tested; user-facing "Real Vite" copy is generalised to "Real npm
  project" / "Dev server". Core packages were already Vite-free; no core change.
- **Single generic Templates switcher; header mode toggles retired (ADR-0079).**
  The duplicate header `Real Vite` / `Dev Mode` segment is removed — the
  Templates gallery is the one switcher (entering `dev`/`real-vite` is selecting a
  tile). The ActivityBar Templates button gains a stable `data-action`; the m7/m10
  e2e specs are updated as a **deliberate contract change** (new view-templates +
  `[data-preset]` flow; m10's stale `[real-vite] …` log markers corrected to the
  `[real-vite/worker] …` the worker actually emits). Resolves Q-2026-06-04-316.
- **Templates switcher polish.** The preset gallery is retitled **Templates**
  and its tiles now use vendored monochrome inline-SVG icons (new `icons.tsx`,
  Lucide/ISC paths, zero new dep) instead of full-colour emoji that clashed with
  the monochrome theme; presets declare a semantic `icon` key so the switcher
  scales cleanly to more templates. (Activity-bar tooltip follows: "Templates".)

### Added

- **e2e-gated execSync-over-SAB harness (`#test=execsync`).** A page-realm harness (`src/execsync-harness.ts`) + guest worker entry (`src/workers/execsync-harness-guest.ts`) that proves rifty's real `execSync` path end-to-end in a cross-origin-isolated chromium Worker — the path Node tests cannot exercise (real SharedArrayBuffer + `Atomics.waitAsync` dispatcher wake + ADR-0084 v2 binary frame; the conformance SAB-blocking cases `skipIf(!sabReady)` in Node). `main.tsx` runs it ONLY when `location.hash` includes `test=execsync` (lazy-imported chunk); normal boot is byte-unchanged. The page realm (which owns the kernel dispatcher) seeds the child scripts into its sync mirror, registers the runtime-js `'execSync'` handler on `getKernelDispatcher()` (via the new `@riftydev/runtime-js/ipc/exec-sync-handler` seam), and `spawnWorker`s a guest that runs `execSync('node /child.js')` where the child writes raw non-UTF-8 bytes `[0xff,0xfe,0x00]`; the guest emits the result hex into the DOM. Asserted by `tests/e2e/execsync-sab.spec.ts`: `hex === 'fffe00'` (a broken v2 frame mangles to U+FFFD → `efbfbd...`; a broken dispatcher hangs → timeout — only the real byte-exact round-trip passes) plus a `blocked-result` blocking round-trip. This harness surfaced the kernel SAB JSON-frame `TextDecoder`-on-shared-view bug (fixed in `@riftydev/kernel`).

- **Lazy `node_modules` browsing in the explorer (ADR-0080).** The reverse
  snapshot (ADR-0076) excludes `node_modules`; a new two-way request/response
  read bridge (`node-modules-port.ts`, the symmetric complement of the one-way
  write/snapshot ports) now lets the real-vite explorer browse it lazily — one
  directory level per expand, fetched from the worker and cached
  (`NodeModulesCache`), with loading/error rows and `node_modules` files opening
  read-only in the editor (≤128 KiB inline, larger shown size-only). A
  normalised-segment scope guard keeps it a package browser, not a general remote
  FS; over-cap files reply `content:null` (no silent empty read). The sync
  `FsOpsTarget` path is untouched — the async branch is keyed only on the
  `node_modules` subtree. Pure logic (the port round-trip, the cache, the
  `composeNodeModulesRows` interleave) is unit-tested.
- **File explorer reflects the Real Vite worker project (ADR-0076).** Switching
  to Real Vite now switches the explorer **into the Vite filesystem**: a new
  one-way worker→page VFS snapshot bridge (`vfs-snapshot-port.ts`, the mirror of
  the page→worker write port) publishes the worker realm's project tree — sans
  `node_modules` — which the page renders through a **read-only** `SnapshotFs`.
  The view is live (updates on install + every Vite watch), honestly read-only
  (mutation controls hidden, a `read-only` badge, worker files open view-only —
  no fake writes), and clears on leaving the mode. Closes the split-VFS gap
  ADR-0075 flagged for real-vite. Pure logic (`collectSnapshot`, `SnapshotFs`)
  is unit-tested.
- **VSCode-style shell (ADR-0075).** Recomposed the playground into a real
  workbench: a lime "alive-spine" **activity bar** toggling the sidebar between
  a **file Explorer** and the Presets gallery, an **editor tab bar** over a
  multi-model Monaco, the **console relocated to a bottom panel** (spanning the
  editor area; collapsible to a header strip without unmounting xterm), preview
  as a right "Simple Browser" pane in dev/real-vite, and a **status bar** (mode,
  active file, language, COI, relocated storage badge). All panels are
  **resizable + collapsible** via a hand-rolled zero-dep `<Splitter>` (pointer
  drag, double-click reset, `role="separator"` + arrow-key resize, persisted to
  `localStorage`, iframe-pointer guard during drag).
- **VFS file explorer (ADR-0075).** Lazy-expand tree of `/workspace` over the
  main-thread `syncMirror()` (reflects shell `npm install` + user edits): open,
  new file, new folder, rename (files and dirs via a real recursive copy), and
  delete-with-confirm; signature-gated 1.5 s poll (the VFS exposes no change
  events). New pure modules under `src/glue` (`file-tree`, `fs-ops`,
  `editor-tabs`, `layout-store`, `splitter-size`) with unit tests.
- **Multi-model editor tabs (ADR-0075).** One Monaco model per tab (`setModel`
  on switch — no spurious writes); a permanent **program tab** stays bound to
  `machine.source`/`setSource` (initial JS runner + dev/real-vite HMR unchanged)
  under a single `suppressProgramEcho` guard; files opened from the explorer get
  their own model with debounced VFS write-back. `monaco-env` gains the json /
  css / html language workers.
- **Preset gallery — click-to-run examples (ADR-0073).** New `src/presets.ts`
  + `src/components/PresetGallery.tsx`: a category-grouped left rail of
  example programs (Welcome, Event-loop order, Node core modules, Virtual
  filesystem, Dev server + HMR, Real Vite + npm). Selecting a preset loads
  its source and switches mode; JS-runner presets auto-run. Every preset is
  grounded in a capability traced through the source and covered by the
  e2e/conformance suites — no stubs. The boot preset still prints
  `worker alive` (M1 e2e contract).
- **Design system "terminal-luxe" (ADR-0073).** New `src/styles/theme.css`
  with CSS-variable tokens (cool-ink palette, acid-lime accent, hairlines,
  film grain, staggered load), class-based components replacing inline
  styles, a custom Monaco `rifty-dark` theme, and self-hosted OFL fonts
  under `public/fonts` (IBM Plex Mono + Bricolage Grotesque, bundled
  `.woff2` assets — no CDN, no npm dep). New `public/favicon.svg`.
- **Honest preview status.** `PreviewPanel` warms up the route, navigates the
  iframe, and reports `live` only on a real navigation commit (else
  `unavailable` with a hint) — see ADR-0073's known-limitation note and
  OPEN_QUESTIONS Q-2026-06-03-308.
- **Netlify hosting (`netlify.toml`).** pnpm monorepo build, COOP/COEP
  headers (mirrored from `public/_headers`), SPA fallback, prod publish of
  `apps/playground/dist`.
- **`useMode.loadPreset()` + `useRuntime.whenReady()/isRunning()`.** Preset
  loading transitions modes; JS-runner eval gates on worker readiness.

### Fixed

- **Production runtime worker never loaded (ADR-0073).** `useRuntime.ts` and
  `main.tsx` now import the worker entries via `?worker&url` instead of
  `new URL(..., import.meta.url)`, so `vite build` actually emits + bundles
  the `worker-entry` / `kernel-worker-entry` chunks. Previously the prod
  build shipped no worker chunk and the runtime worker crashed on boot
  (`[worker error] undefined`) in any hosted build — invisible to CI, which
  only runs against `pnpm dev`.
- **Monaco language-service console spam.** New `src/glue/monaco-env.ts`
  wires `MonacoEnvironment.getWorker` (Vite `?worker` imports), removing the
  per-keystroke `toUrl` `TypeError` from the TS diagnostics adapter.
- **Editor ignored external source changes.** `EditorPanel` now reacts to
  `value` updates, so selecting a preset actually replaces the editor
  content.
- **Auto-run / Run could throw "Runtime is not running"** when fired before
  the worker booted — both now gate on `useRuntime.whenReady()`.

- **`npm install …` at the shell prompt (follow-ups item #15, 2026-05-27).**
  New glue file `apps/playground/src/glue/npm-shell-command.ts` registers
  an `npm` builtin on the long-lived `ShellSession` so typing
  `npm install express` in the terminal actually runs the installer
  instead of returning exit 127 ("command not found"). Supports
  `install` / `i` / `add` subcommands, plain `name`, `name@range`,
  scoped `@scope/name[@range]`, auto-creates a minimal `package.json`
  when the project has none, and merges new deps into existing ones.
  Bare `npm install` reads existing deps but does **not** rewrite
  `package.json`, so re-runs do not churn mtimes. Error mapping for
  `EVERSIONCONFLICT` / `EINTEGRITY` / `EBROKENLOCK` produces single
  operator-friendly stderr lines instead of stack traces. Flags
  (`--save-dev` etc.) are explicitly rejected as M9-scope. The
  `install` function is injected via a DI seam so the unit tests run
  without reaching across into another package's `_test-fixtures/`.
- **`ShellSession.registerCommand(name, cmd)` accessor.** Exposes the
  underlying `Shell.registerCommand` so composition-root glue can wire
  builtins (`npm`, future `node`) without `useShellSession` needing to
  know about them.

### Changed

- `adapters/useMode.ts` — extracted the `repl | dev | real-vite` mode state
  machine out of `App.tsx`. The new adapter owns the `mode` signal, the
  dev/real-vite handles, the real-vite port, and the editor source, and
  exposes `toggleDev` / `toggleRealVite` / `setSource` transitions that
  preserve the original branch-on-`mode()` semantics byte-for-byte. App.tsx
  shrinks to JSX + wiring (315 → 259 LOC; four signals + two transition
  branches moved into the adapter). Closes the P0 finding in the 2026-05-26
  playground audit ("App.tsx is a god-component juggling lifecycles the
  adapters should own").
- **ADR-0040:** the preview-bridge handshake stamped by
  `mountPlaygroundPreviewBridge()` now sends two version fields
  (`frameVersion`, `routingVersion`) instead of a single `version` field.
  The change is transitive — `setupPreviewBridge` from
  `@riftydev/service-worker` does the actual stamping; the playground
  wiring is untouched at the call site. A version mismatch on either
  contract surfaces as HTTP 503 from the SW the same way as before,
  with the warning now naming the drifted contract (`frame` or
  `routing`).

### Added

- Initial Solid UI scaffold: header + Monaco editor + xterm.js terminal in a 1:1 split, plus Run / Reset buttons.
- COOP/COEP headers in `vite.config.ts` (D-001) for cross-origin isolation, both in `server` and `preview` modes.
- Capabilities-detection fallback panel that explains which feature is missing if the browser isn't cross-origin-isolated.
- Service Worker registration on mount; failures surface in the terminal (red).
- `useRuntime` adapter as the single bridge between Solid signals and the framework-agnostic runtime controller (D-002).
- Dev proxy `/npm-registry → registry.npmjs.org` to make M9 wiring testable from day 1 (D-004).
- Runtime cross-origin-isolation guard (`assertCrossOriginIsolated` in `src/boot.ts`): if the page boots without `crossOriginIsolated === true`, paint an inline fatal banner and throw before any SAB-consuming code runs. Defence-in-depth for ADR-0002 in case COOP/COEP headers regress at the host.
- `bootstrapPlayground()` — single awaited pipeline in `src/boot.ts` that runs the COI guard, `initBackend()` (VFS), and `registerServiceWorker('/sw.js')` in order. `main.tsx` awaits it before `render(...)`, so the App always sees a fully-resolved boot bundle. Closes A-004 (REVIEW_ACTIONS): persistence wiring is in place, plus an e2e reload assertion in `tests/e2e/m0-boot.spec.ts`.

### Added

- `adapters/shell-adapter.ts` — `useShellSession()` hook that owns a
  long-lived `@riftydev/shell` `Shell` and forwards stdout/stderr to the
  terminal writer via the new `onChunk` callback. App.tsx consumes it in
  `dev` / `real-vite` modes so users can drive `npm install`, `vite dev`,
  file ops, and `&&`-chained commands from the terminal in real time.
  Closes Tier 0 finding 1 in the 2026-05-26 review (`@riftydev/shell` was
  declared as a dep but had zero consumers).
- `adapters/hmr-bridge.ts` — cross-realm HMR bridge (ADR-0017 phase 1
  acceptance). `setupHmrBridge({port})` hosts a `BridgedWebSocketServer`
  on `ws://preview.local:<port>/__hmr`; `createHmrBridgeVitePlugin({port})`
  injects a vanilla-JS `BroadcastChannel` client into the served
  `index.html` via `transformIndexHtml`; `realVite.ts` wires
  `server.watcher.on('change', ...)` to broadcast through the bridge.
  The iframe HMR client and Vite-side server now share the bridge's
  wire protocol — no native `WebSocket` involved, so HMR survives the
  page ↔ iframe realm boundary. Precursor to M11 A-026 (Vite-in-Worker):
  the migration becomes a realm swap, not a routing rewrite. Closes
  Tier 2 finding 9 in the 2026-05-26 review (`BridgedWebSocket` was
  built but had no callsites).
- `adapters/preview-bridge-wiring.ts` — `mountPlaygroundPreviewBridge()`
  extracts the byte-identical `setupPreviewBridge` handler that
  `devMode.ts` and `realVite.ts` each carried in-place. Closes the
  "Duplicated preview-bridge wiring" finding in the 2026-05-26
  architecture review (Appendix → playground).

### Changed

- `App` no longer races a `registerServiceWorker()` call in `onMount`. The SW is registered by `bootstrapPlayground()` before render; failures flow through `BootResult.swError` to the existing dismissible banner. Removes the small window where the JS runner was interactive but the preview iframe was not yet routable.

### Fixed

- `SyncMirrorVfs.openReadable` now throws `NotImplementedError('SyncMirrorVfs.openReadable')` instead of a bare `Error` — surfaces the gap as a structured, catchable error per the CLAUDE.md "no silent stubs" hard rule. The path is preserved in the hint for diagnostics.
