---
area: playground
status: draft
title: Re-prove Vite non-editor file changes after sync-rpc fs.watch work
created: 2026-06-21
why: the old premise ("chokidar gets no events over the VFS") is partly stale after sync-rpc fs.watch and Readable fixes, but there is still no browser e2e proving a terminal/tool write updates a live Vite preview through the normal `.bin` path.
user_story: As a dev who changes a project file from the terminal or a tool, I want the preview to pick it up like a real `vite` dev server, but today the current proof covers editor saves and lower-level watch plumbing, not the end-to-end non-editor Vite flow.
sources: [apps/playground/src/workers/dev-server-controller.ts, apps/playground/src/workers/dev-server-boot.ts, apps/playground/src/workers/real-vite-invalidation.ts, packages/runtime-js/src/ipc/sync-rpc-fs.test.ts, packages/io/src/streams/readable.async-read.test.ts]
code: [apps/playground/src/workers/dev-server-controller.ts, packages/runtime-js/src/ipc/sync-rpc-fs.ts]
---

## Context

This item was written when Vite's watcher effectively saw only editor-save IPC.
Current HEAD is better:

- `SyncRpcFsSync` has a unit proof that polling `fs.watch` in a child observes
  owner-store writes.
- `Readable` now calls subclass async `_read`, covering a chokidar/readdirp-like
  stream shape.

That does not yet prove the end-to-end user scenario: a terminal or tool writes a
file while Vite is running through the normal `.bin` path and the preview updates
without a manual editor-save IPC.

## Options or Next

First re-triage with a browser e2e on the normal `.bin/vite` path:

- start a Vite preview;
- write `src/main.js` from the terminal (`node -e`, `printf`, or another tool);
- assert Vite's watcher/HMR observes it and the iframe updates.

If green, delete this item and update stale comments that still claim the VFS
fires no real watcher events. If red, refine to `ready` with the exact missing
watch boundary (runtime `fs.watch`, sync-rpc owner store, chokidar stream, or
dev-server controller IPC).

## Reversibility

REVERSIBLE — change-notification plumbing over the existing VFS + invalidation
path; no public-API/ADR change (complements ADR-0148 co-resident dev server).
