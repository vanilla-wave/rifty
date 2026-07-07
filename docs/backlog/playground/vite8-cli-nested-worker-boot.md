---
area: playground
status: draft
title: Vite 8 (Rolldown) via the real `vite` CLI — foreground `.bin` child can't spawn the WASI worker pool
created: 2026-07-07
why: A user's `npm install vite` today resolves to vite 8; running it through the real `vite` CLI (`npm run dev`) never becomes ready, because the foreground `.bin` child worker does not forward the kernel/node-entry worker URLs, so Rolldown's `@rolldown/binding-wasm32-wasi` pthread pool falls back to same-realm and the dev server hangs — a silent no-boot with only a worker_threads warning.
user_story: As a user who runs `npm install vite && npm run dev` (getting vite 8), I want the dev server to either boot or refuse loudly with a diagnosis, not hang past the readiness window with a buried "same-realm fallback" warning.
sources: [docs/adr/runtime-js/0162-vite-8-rolldown-wasi-browser-boot-runtime-surface.md, docs/adr/shell/0150-supervised-child-processes-over-sab-sync-views-d-p6.md, docs/adr/playground/0161-vite-8-disables-hmr-pending-socket-parity.md]
code: [apps/playground/src/workers/owner-child-bin-executor.ts, apps/playground/src/workers/owner-child-dev-server.ts, apps/playground/src/workers/dev-server-child-bootstrap.ts]
---

## Context

Two dev-server spawn paths exist. The **co-resident dev server** (Path A, `createOwnerChildDevServer` → `dev-server-child-bootstrap`) forwards `RIFTY_KERNEL_WORKER_URL` + `RIFTY_NODE_ENTRY_WORKER_URL` so a nested worker (Rolldown's WASI pthread pool) can spawn — this is how the `vite8` PRESET boots. The **foreground `.bin` executor** (Path B, `createOwnerChildBinExecutor` → `buildChildSpawnSpec`) does NOT forward those URLs; it only sets `RIFTY_BIN`/`RIFTY_REMOTE_FS`/`RIFTY_NODE_SERVE`. So when a user runs the real `vite` CLI (`npm run dev`) and it is vite 8, Rolldown logs `kernel.spawnWorker capability not available … same-realm fallback` and the dev server never listens.

vite 7 (esbuild, no dev pthread pool) boots fine through Path B — proven by `tests/e2e/manual-vite-install.spec.ts` (pinned to `vite@^7.0.0`). vite 8 support is explicitly opt-in and upstream-blocked for build/preview (ADR-0173); this item is the DEV path gap for the real CLI specifically.

## Options or Next

- Forward the kernel/node-entry worker URLs in `buildChildSpawnSpec` (like the dev-server child) so a foreground `.bin/vite@8` can spawn Rolldown's WASI pool. Verify against a vite-8-pinned manual-install e2e.
- OR, if the bin child genuinely cannot host nested workers, make the fallback LOUD: detect Rolldown's same-realm degradation and surface a Node-shaped diagnosis in the terminal instead of a silent hang.
- Whatever the choice: no silent no-boot. Today's warning-then-hang violates the fidelity mission.

## Reversibility

REVERSIBLE — a spawn-spec env addition or a loud-throw. No public API / disk format. An IRREVERSIBLE "bin children may host nested workers" capability decision would get its own ADR.
