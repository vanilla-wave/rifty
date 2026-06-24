# ADR 0143: Bin/shell execution model: owner-worker vs SAB fs-proxy

Status: Accepted (2026-06-14)
Date: 2026-06

> TL;DR: The shell/bin/`execSync` execution model becomes a single **owner-worker** that holds `node_modules` AND supervises execution (PAGE = viewer over the existing async ports) — NOT a SAB fs-proxy that reads PAGE memory over the wire. IRREVERSIBLE, milestone-scale; its real P1 gate is a deferred IRREVERSIBLE of its own — a kernel server-process model (ADR-0077 follow-up).

> Correction 2026-06-23: the original TL;DR pointed at a pre-ADR backlog analysis file. That file is now retired after the owner-worker child path closed the shell `.bin` transport; this ADR itself is the surviving historical record.

> Correction 2026-06-23: the original TL;DR also said the owner "runs the CLI in-realm." Later P6a moved `.bin` commands to supervised child workers over owner remote-fs so the owner stays responsive; `execSync` node-entry routing remains a separate residual.

## Context

ADR-0137 delivered shell `.bin` resolution + the execution MECHANISM (`runNodeEntry` + loader, node-tested + parity), but a real CLI does NOT run end-to-end. **Dead link (re-verified 2026-06-14):** the spawned bin/`execSync` worker passes its OWN empty `MemoryFsSync` (`node-entry-bootstrap.ts` → `runNodeEntry({ vfs: syncMirror() })`; the kernel pre-entry hook `kernel-worker-entry.ts` installs ONLY the `process` shim, no fs mirror), so `node-entry.ts` `opts.vfs.readFileBytesSync(entryPath)` → ENOENT. The path travels as a string; the files do not.

**Verified premises (non-negotiable — do not re-litigate):**
- The shell's ad-hoc `npm install` writes to **PAGE memory** (ADR-0135: page realm is memory-backed, sync OPFS is worker-only; the page-side ad-hoc install stamps under slug `''`, reused by no worker).
- **No shared OPFS** — page↔worker shared-OPFS warm-up is impossible (ADR-0135).
- `OpfsFsSync` is a **per-realm boot snapshot + fire-and-forget async write-through, NOT live-coherent** (ADR-0072): nothing calls `refreshIndex`/`preloadContent` after boot, so a second realm opening OPFS sees a stale snapshot.
- The playground bin/`execSync`/real-vite workers are **memory-backed today** — `initBackend()` runs only in the separate runtime-js REPL worker-entry, never on the kernel-worker path; `flushSyncMirror` no-ops on `MemoryFsSync`. (ADR-0135 *intends* a worker-owned OPFS tree for the preview owner; it is not wired on this path. Stale "OPFS-owning realm" comments in `real-vite-bootstrap.ts` are aspirational.)

So the old next-step ("`initBackend()` OPFS in the bootstrap / share the install realm's VFS") cannot fix the shell flow — it conflated the shell flow with the preview/install flow (different owner). The fork:

- **B** — files stay on PAGE; the worker reads them synchronously on demand over a SAB ring (worker `Atomics.wait`s, PAGE responds).
- **D** — one owner-worker holds `node_modules` + execution; PAGE becomes a thin viewer over the already-shipped async ports.

## Decision

**D — single owner-worker.** B only as a deletable stepping stone if D cannot land in one slot.

Why D (verified):
- **Removes the bug class** — no cross-realm fs in the hot path → no ENOENT, no read-while-PAGE-mutates race, no `fs.read` handler surface to keep coherent, no UI-jank responder.
- **Collapses store multiplicity** — today three memory stores (PAGE + preview worker + bin worker) stitched by ports/proxies; D = one owner per workspace.
- **Converges with the already-shipped real-vite owner** — `serveNodeModulesReads` + `vfs-snapshot-port` + `vfs-write-port`, consumed by the PAGE explorer/editor (`App.tsx`), are exactly D's viewer machinery, generalized.
- **Best fit for the project's #1 goal** — "the process owns its filesystem, the UI is a viewer over a port" IS how WebContainers/StackBlitz work; B teaches a worker→PAGE SAB-fs-proxy direction real systems don't use.

**Refinements from adversarial verification (baked in, honest):**
1. **D's real P1 gate is itself a deferred IRREVERSIBLE.** D's "reuse the real-vite owner" rests on a worker with NO process lifecycle: it stays alive only via the ADR-0077 keep-alive hack (`await new Promise<never>(() => {})`), is per-preview, and is killed on mode-leave. ADR-0077 *rejected* fixing worker lifetime in the kernel (IRREVERSIBLE, broad blast radius) and filed "the kernel should natively support server-shaped processes" as a follow-up. **D is two stacked irreversibles**: P1 ratifies that follow-up (kernel server-process model); the rest of D is gated on it.
2. **B is cheaper / less novel than the pre-ADR doc framed**, but still not the destination. B extends the ALREADY-shipped ADR-0087 worker→PAGE SAB sync-IPC `execSync` responder with `fs.read` handlers — not a forbidden trick (ADR-0080's anti-SAB lean is scoped to the file *browser*'s UI freeze, not a blanket no-SAB). BUT B-on-PAGE still janks (PAGE is already the `execSync` responder; a single CLI resolve = hundreds–thousands of fs round-trips flooding the PAGE loop; sustained for watch/long-running CLIs), and the worker→PAGE fs *direction* is throwaway under D.
3. **No viable third option.** ADR-0080's async BroadcastChannel read bridge is kept OFF the sync `FsOpsTarget` by design; a synchronous CLI loader cannot consume it without the sync-over-async shim ADR-0080 rejected.

**The `execSync` entry-kind flip is PART OF D, not a standalone increment.** Re-verification found a regression the pre-ADR doc and a verification agent both missed: flipping `execSync`'s browser path to `kind:'url'` (node-entry bootstrap) **regresses the passing COI e2e `tests/e2e/execsync-sab.spec.ts`**. Today `execSync` works because `kind:'source'` carries the script BYTES in the spec (`handlers.ts` resolves them on PAGE; the child never reads a file); `kind:'url'` makes the child read `entryPath` from its OWN empty store → ENOENT. So the flip is NOT transport-independent for the production path (only for stubbed unit/conformance) and must land WITH D's owner-worker (which makes `kind:'url'` reads succeed) — see `docs/backlog/runtime-js/execsync-node-entry-loader.md`.

### Scope / phasing (separate milestone)

- **P1** persistent workspace-owner worker + kernel server-process model (the gate; ADR-0077 follow-up).
- **P2** PAGE terminal → thin client over a pty-like channel.
- **P3** generalize the snapshot / nm-read / vfs-write ports for editor + explorer.
- **P4** unify with the real-vite preview owner (else the two-owners trap).
- **P5** OPFS persistence in the ONE owner — deliberate, not inherited (preview owner is memory-backed today); accept the ADR-0072 `O(total bytes)` preload cost, paid once in one place.
- **P6** SAB sync-views for concurrent spawned processes (worker→worker — B's mechanism, served the right direction). B and D compose at the limit (WebContainers = owned store + SAB sync views).

## Alternatives considered

- **B (SAB fs-proxy to PAGE).** Stepping stone only — see refinement 2. Unblocks the real-CLI e2e fastest, behind a deletable seam, but janks the UI and builds a throwaway direction.
- **Shared OPFS / "just `initBackend()`".** Impossible (ADR-0135) and incoherent cross-realm (ADR-0072) — the trap the pre-ADR doc exists to kill.
- **Async cross-realm read for execution.** Rejected — ADR-0080's read bridge is async-only and off the sync `FsOpsTarget`; sync CLI execution can't use it.

## Consequences

- (+) Retires the ENOENT bug class at the root; one owner per workspace; one model that matches real WebContainers — directly serves the "agents/humans understand this first try" goal.
- (−) Milestone-scale: multi-ADR, blast radius shell + terminal + playground + net; **two stacked irreversibles** (kernel server-process model first).
- (−) Single owner = one JS thread → a CPU-bound CLI stalls everything else in that realm until P6 SAB sync-views; true "shell usable while `vite` runs" needs P6.
- (−) Historical at acceptance: `cowsay` / real-CLI end-to-end stayed blocked until the milestone landed; `execSync` shebang/relative-import support lands inside D (not before — the standalone flip regresses `execsync-sab.spec.ts`). Corrected 2026-06-23: shell `.bin` real-CLI execution is now delivered by the owner-worker child path; the `execSync` node-entry residual remains separate.
- Follow-ups: raise the **kernel server-process model** ADR (P1 gate / ADR-0077 follow-up) before D P1; ADR-0137 root-cause corrected in place; `node-entry-bootstrap.ts` stale "SAB-backed sync mirror" comment fixed.

## Reversibility

IRREVERSIBLE — changes the execution model + which realm owns `node_modules` + adds public surfaces. Does NOT supersede ADR-0137 (builds on its frozen `BinExecutor` / `runNodeEntry` / `setNodeEntryWorkerUrl` seams) or ADR-0077 (ratifies its deferred kernel-server-process follow-up); corrects ADR-0137's wrong root-cause sentence in place. Relates: ADR-0137, ADR-0135, ADR-0080, ADR-0072, ADR-0084, ADR-0087, ADR-0077, ADR-0011.
