---
area: playground
status: active
title: Node-server templates do not restart on entry edits (no nodemon equivalent)
created: 2026-06-12
why: editing src/main.js in the express-sqlite demo updates the VFS but the running server keeps the old code; user must re-run `npm run dev` by hand
sources: [ADR-0130]
code: [apps/playground/src/workers/real-vite-bootstrap.ts]
---

## Context

Vite templates self-reload via the HMR bridge + module invalidation (ADR-0097/0126). Node-server templates (ADR-0130) `loader.import` the entry ONCE; `handleVfsWrite` publishes snapshots but nothing restarts the program. Restart today = re-run the dev script (kills + respawns the worker, loses the in-memory sqlite DB — see net/sqlite-opfs-persistence).

## Options or Next

1. Watch entry + project files in the worker; on change, tear bridges, re-import entry in a FRESH worker (nodemon semantics). Needs loader cache reset → simplest honest unit is full worker respawn driven from the page (restartDevServer already exists).
2. Surface a "Restart server" affordance (⌘K action / terminal hint) as the cheap interim.

## Reversibility

REVERSIBLE — UX/lifecycle policy; recorded here + ADR-0130 follow-ups.
