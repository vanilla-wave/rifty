# ADR 0146: PTY channel and owner-resident shell — ADR-0143 P2

Status: Accepted (2026-06-14)
Date: 2026-06

> TL;DR: The `Shell` + cwd/env + npm-install + bin/`execSync` execution move WHOLESALE into a persistent **workspace owner** (the real-vite bootstrap generalized to a mode-parametrized owner, spawned `serve:true` at App-mount, addressed by a stable `workspaceId`); the PAGE terminal becomes a thin client over a **pty channel = structured `pty:*` frames on the kernel fork-mode IPC MessagePort** (control AND stdout/stderr chunks on one ordered channel, `sessionId`+`runId` correlated). No kernel API change (kernel stays generic; pty is a playground-layer protocol). This is ADR-0143 **P2**, gated on ADR-0144 (`serve`).

> Correction 2026-06-23: this ADR records the accepted P2 target. The landed package-tooling slice is narrower: owner-resident shell/npm plus supervised child Node workers over the owner remote-fs path close browser `.bin` execution for Prettier/ESLint-class CLIs; `execSync` node-entry routing remains a separate residual (`docs/backlog/runtime-js/execsync-node-entry-loader.md`).

## Context

ADR-0143 chose D (owner-worker holds `node_modules` + runs the shell/CLI in-realm; PAGE = viewer) and ADR-0144 landed P1 (`serve` keep-alive). At acceptance time the shell still ENOENTed end-to-end: `new Shell` lived on PAGE (`terminal-manager.ts:86`), `npm install` wrote PAGE memory (`App.tsx:326` over `SyncMirrorVfs`), and each `.bin` invocation spawned a kernel worker with its OWN empty store (`App.tsx:355` → `bin-executor.ts`) → `runNodeEntry` read an empty mirror → ENOENT (ADR-0143 dead link). `packages/shell` is realm-agnostic (deps = io+vfs only; verified) — the class body needs NO change; what coupled the FLOW to PAGE was (1) who installs `syncMirror()`, (2) who supplies `execBin`, (3) the PAGE consumers holding the `Shell` + the in-process `onChunk`/`signal`/`stdin` plumbing. P2 relocates all three into the owner and replaces the in-process call with a wire.

Subsystem map (verified 2026-06-14): kernel stdout/stderr/stdin streams carry ONLY `Uint8Array` (byte, `bindPortAsReadable`/`bindPortAsWritable`) — a framed protocol cannot ride them; the fork-mode IPC MessagePort (`handle.send`/`process.on('message')`, ADR-0045) is the ONLY existing structured page↔owner channel and already carries `rifty:vfs-write` frames. The real-vite owner is the working persistent-owner prototype (`serve:true`, owns its `syncMirror`, serves snapshot/nm-read/vfs-write ports) but is spawned per-`vite`-run and killed on mode-leave; its install/loader/store/serve machinery is realm-generic, the vite/HMR/preview tail is runtime-specific.

## Decision

**1. Persistent workspace owner, one parametrized entry.** Generalize `real-vite-bootstrap.ts` into a mode-parametrized **workspace owner** (`shell` mode: persistent, no vite tail; `preview` mode: per-run, with the vite/node tail — today's behavior). P2 spawns it in `shell` mode at App-mount, `serve:true`, living the whole session, addressed by a stable `workspaceId` (decoupled from the dev-server port). The existing per-`vite`-run preview spawn stays for now.

**2. PTY channel = structured frames on the kernel fork-IPC MessagePort.** No new kernel channel, no kernel API change (the kernel stays generic; pty framing is playground-layer). ALL pty traffic — control AND stdout/stderr chunks — rides this ONE ordered channel, so chunks and the exit frame cannot reorder (no chunk-vs-exit truncation race). The byte stdout/stderr streams remain for the owner's OWN diagnostics, separate from command output.

Frame protocol (`sessionId` = N-shells-in-one-owner multiplex; `runId` = one-line→exit correlation):

```
page → owner: pty:open{sid} | pty:exec{sid,rid,line,cols,rows,isTTY}
              pty:stdin{sid,rid,data} | pty:stdin-eof{sid,rid}
              pty:signal{sid,rid,'SIGINT'} | pty:resize{sid,rid,cols,rows} | pty:close{sid}
owner → page: pty:ready{sid}
              pty:chunk{sid,rid,stream:'stdout'|'stderr',seq,data}
              pty:exit{sid,rid,code,cwd,env,error?}
```

`seq` per chunk = loss-detect (preview-port discipline). cwd/env are owner-authoritative and pushed on `pty:exit` (cd/export mutate only during a run); PAGE caches them so `toSnapshot` stays a sync read for persistence/signals. A structured `pty:ready` handshake replaces the stdout log-string match + `publishSnapshot` retry-storm.

**3. Relocate npm + bin into the SAME owner store (atomic).** `npm install` runs against the owner `syncMirror()`; `execBin` runs the resolved shim via `runNodeEntry` IN-REALM (the per-bin worker spawn collapses) so `kind:'url'` reads hit the populated owner tree. Moving one without the other re-introduces ENOENT — they land together. `BinExecutor`/`runNodeEntry`/`setNodeEntryWorkerUrl` seams stay frozen (ADR-0137); only the realm + the spawn body change.

> Correction 2026-06-23: `.bin` execution landed through the owner-worker child path with remote-fs access to the owner tree, not by collapsing every bin into the owner realm. The fidelity point is preserved (real shim, real loader, populated owner store); the concurrency/`execSync` parts remain governed by their later residuals.

**4. SIGINT cooperative, NOT `handle.kill`.** Ctrl-C → `pty:signal` → the owner aborts that run's `AbortController` → `exit 130` (ADR-0089 cooperative model preserved). `handle.kill` would terminate the whole persistent owner — wrong. A thrown command error folds into `pty:exit{error}` (no shared cross-realm object).

**5. PAGE thin client.** `terminal-manager.ts` becomes a pty port client (holds `sessionId` + handle, no `Shell`); `RiftyTerminal`/`TerminalPanel` unchanged (DOM-bound, stay on PAGE); the dead-duplicate `shell-adapter.ts`/`useShellSession` (referenced only by its own test) is removed.

### Scope (v1) + deferred

- **Two-owners is a TRACKED transient → P4 closes it by SUBSUMPTION:** P4 runs the vite tail co-resident inside THIS persistent owner and deletes the per-run preview spawn — the workspace owner built here IS the future single owner, not throwaway. Until P4, the dev-server preview does NOT see terminal-installed deps (the exact gap P4 fixes). No residual debt at milestone close.
- No backpressure (credit/ack) — follow-up; no cwd-in-prompt (`'> '` const, `RiftyTerminal` has no prompt seam) — follow-up; hard-kill only (graceful drain/flush) — P5; per-session worker isolation (single owner thread, CPU-bound CLI stalls the realm) — P6.

### Alternatives

- **New dedicated pty MessagePort (5th channel in `spawnKernelWorker` + `WorkerStdioPorts`).** Rejected: kernel API change that couples the generic kernel to a playground `pty` concept; the fork-IPC channel already exists and carries structured frames.
- **BroadcastChannel side-port (like vfs-write/snapshot/nm).** Rejected: those keys derive from the dev-server PORT — a persistent owner with NO dev server has no such key; duplicates a transport the kernel handle already provides.
- **Chunks on the byte stdout Readable, control on IPC (hybrid).** Rejected: two channels reorder — the exit frame can overtake late stdout chunks (and the EOF drop-guard discards post-exit chunks) → truncated output.
- **A separate throwaway shell-owner worker.** Rejected: P4 would have to merge two codebases = tech debt; the mode-parametrized one-entry generalization makes P4 a collapse.

## Consequences

- (+) Historical target: kill the ENOENT bug class at the root by making shell, `npm`, bin/`execSync` share one in-realm store; `cowsay hi` runs end-to-end. Corrected 2026-06-23: the delivered `.bin` path closes this for real package-tooling CLIs through owner-worker child execution; `execSync` node-entry routing is still tracked separately.
- (+) Editor/explorer read the persistent owner (not dev-server-gated) — the tree exists before/after any vite run; P3 generalizes the same ports.
- (+) No kernel change; `packages/shell` + `packages/terminal` untouched (realm + host wiring flip only). The owner built here is P4's single owner (no throwaway).
- (−) Single owner JS thread: a CPU-bound CLI stalls the owner (dev server + other sessions) until P6.
- (−) Whole owner needs `crossOriginIsolated` (`isSabIpcSupported` gate) — no PAGE shell fallback under D.
- (−) Hard-kill only until P5 (in-flight command/write lost on terminate).
- Follow-ups: P3 (generalize owner ports + write-coherence), P4 (unify preview owner — closes the two-owners transient), P5 (OPFS + graceful stop), P6 (SAB sync-views for concurrency); backpressure + cwd-in-prompt as standalone follow-ups.

## Reversibility

IRREVERSIBLE — defines a wire contract (the `pty:*` frame protocol), moves which realm owns execution + `node_modules`, and adds PAGE/owner public surfaces (the pty client + workspace-owner handle). Builds on ADR-0143 (its P2), ADR-0144 (`serve` gate), ADR-0137 (frozen `BinExecutor`/`runNodeEntry`), ADR-0089 (cooperative SIGINT), ADR-0045 (fork IPC). Relates: ADR-0072, ADR-0080, ADR-0087, ADR-0135, ADR-0011.

> **Correction 2026-07-26 (ADR-0326):** PTY frames remain on the same dedicated
> physical child port but occupy the private typed control lane, never public
> fork IPC. This preserves ordered PTY/control lifetime after a guest
> `disconnect()` without exposing host frames through Node `'message'`.
