---
area: shell
status: active
title: Graceful OPFS drain before the workspace owner terminates
created: 2026-06-15
why: P5 wired OPFS persistence via write-through (best-effort, ADR-0072); the owner is still hard-killed (handle.kill / browser reload), so the last in-flight writes can be lost on close
user_story: As a developer who edits a file then immediately reloads/closes the tab, I want the very last write to be durable, not just best-effort — the owner should drain its OPFS write-through before it goes away.
sources: [ADR-0143, ADR-0144, ADR-0072, ADR-0148]
---
## Context
P5 (ADR-0143 "D") made the workspace owner OPFS-backed: `await initBackend()` + the OPFS content-cache write-through (ADR-0072) persists the tree. The install path awaits its stamp flush, so `node_modules` is durable. Everything else relies on the write-through draining on its own — best-effort, the "slightly behind on close" posture ADR-0072 accepts for a dev runtime.

A per-command awaited flush (`pty:exit`) was tried in P5 and **reverted**: `OpfsFsSync.flush()` drains the WHOLE pending queue, so during boot (node_modules restore still draining) every command's exit blocked on unrelated I/O, stalling the shell and flaking e2e. So there is no flush barrier today.

The ADR-0144 server-process model is still hard-kill: `WorkspaceOwnerHandle.close()` → `handle.kill('SIGTERM')` (App unmount / preset is single-owner), and a `page.reload()`/tab-close terminates the worker outright. In-flight write-throughs at that instant are lost.

## Options / Next
A graceful drain needs a page→owner request that the owner answers by `await syncMirror().flush()` before the page proceeds to `handle.kill` — and a `beforeunload`/`visibilitychange`-driven flush for reload/close (unreliable for async work, so likely best paired with the P6 owner-lifecycle rework / supervised children). A scoped flush (drain only the current command's writes, not the whole queue) would let a per-command barrier return without the boot-stall — needs an `OpfsFsSync` API to await a bounded slice of `pending`. Decide at P6 when the owner lifecycle is reworked.

## Reversibility
REVERSIBLE — additive durability hardening over shipped write-through; no public-API or wire-format change. Backed by ADR-0072 (write-through) + ADR-0144 (server-process model).
