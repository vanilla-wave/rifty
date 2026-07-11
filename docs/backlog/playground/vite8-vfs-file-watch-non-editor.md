---
area: playground
status: draft
title: vite8 — non-editor file changes don't update the preview (chokidar dead over the VFS)
created: 2026-06-21
why: Vite's chokidar watcher gets NO events over rifty's VFS (sync-mirror/OPFS fires no real fs.watch); only editor saves route via a bespoke IPC. A file changed from the terminal (`echo > src/x.js`), a generated file, or an `npm`-written file triggers ZERO preview reaction — real Vite would watcher-detect it and (HMR off) full-reload.
user_story: As a dev who changes a project file from the terminal or a tool, I want the preview to pick it up like a real `vite` dev server, but today only in-editor saves are seen and every other writer is silently ignored (stale preview, no hint).
sources: [packages/workbench/src/workers/dev-server-controller.ts, packages/workbench/src/workers/dev-server-boot.ts, packages/workbench/src/workers/real-vite-invalidation.ts]
code: [packages/workbench/src/workers/dev-server-controller.ts]
---

## Context

`dev-server-controller.ts` documents it: "the virtual FS fires no real watcher
events." `server.watcher?.on('change', …)` is wired but never fires; the only
change signal is `onFileChanged` fed by editor-save IPC (`dev-server-child-bootstrap.ts`).
So ANY non-editor writer (terminal, generated file, `npm`, a running program)
produces no invalidation and no reload. This is broader than the HMR-off story
(ADR-0161): even a full reload is never triggered for those writers.

## Options or Next

Emit VFS change events for ALL writers (not just the editor IPC) and feed them
into Vite's watcher/invalidation — i.e. bridge real `fs.watch`-shaped change
notifications over the sync-mirror/OPFS layer. With HMR off, a non-accepted
change should at least full-reload the preview (real-Vite behavior). Acceptance:
a terminal `echo >> src/main.js` updates the preview (manual reload or auto),
proven by a test driving a non-editor write.

## Reversibility

REVERSIBLE — change-notification plumbing over the existing VFS + invalidation
path; no public-API/ADR change (complements ADR-0148 co-resident dev server).
