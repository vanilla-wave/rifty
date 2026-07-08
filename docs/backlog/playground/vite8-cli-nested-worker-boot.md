---
area: playground
status: ready
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

## User scenario

A developer creates a normal package, runs `npm install vite` (resolving to Vite
8), then runs `npm run dev` or `vite --port 5174` through the terminal. The CLI
must either boot and publish the real selected port, or print a clear terminal
diagnostic that names the missing nested-worker capability. It must not sit past
readiness with only a buried same-realm `worker_threads` warning.

## Acceptance

- Browser e2e RED first: install a Vite 8 package through the normal terminal
  path, run the real `.bin/vite` CLI, and assert the current no-ready/hang or
  buried warning.
- Preferred fix: forward `RIFTY_KERNEL_WORKER_URL` and
  `RIFTY_NODE_ENTRY_WORKER_URL` into the foreground `.bin` child spawn spec so
  Rolldown's WASI pthread pool can create real worker children.
- If the foreground bin child cannot host nested workers, detect the same-realm
  Rolldown fallback and fail loudly in the terminal before the readiness window
  expires.
- The Vite 7 manual-install e2e stays green; no Vite 8-only env broadens the Vite
  7 path.

## Parity cases

- Real Node Vite 8 starts the dev server through the installed CLI and prints a
  ready URL.
- Rifty Vite 8 through the normal `.bin` CLI either reaches the same ready state
  or throws a named, user-facing platform ceiling.
- The opt-in Vite 8 preset path continues to use the co-resident child that
  already forwards nested-worker URLs.

## Fault matrix

- `false-fallback` x missing nested-worker capability -> loud terminal
  diagnostic, never a silent readiness timeout.
- `observable-order` x Vite CLI startup -> the CLI's own argument/config handling
  runs before rifty reports the nested-worker ceiling.

## Options or Next

- Forward the kernel/node-entry worker URLs in `buildChildSpawnSpec` (like the dev-server child) so a foreground `.bin/vite@8` can spawn Rolldown's WASI pool. Verify against a vite-8-pinned manual-install e2e.
- OR, if the bin child genuinely cannot host nested workers, make the fallback LOUD: detect Rolldown's same-realm degradation and surface a Node-shaped diagnosis in the terminal instead of a silent hang.
- Whatever the choice: no silent no-boot. Today's warning-then-hang violates the fidelity mission.

## Out of scope

- Vite 8 production build/preview; tracked in
  `playground/vite8-production-build-preview`.
- Re-enabling Vite 8 HMR; tracked in `playground/real-vite-browser-e2e`.
- Non-Chromium browser support.

## Decisions

- Booting is preferred over a loud ceiling when forwarding nested-worker URLs is
  enough; otherwise a loud diagnostic is the honest outcome.
- This item covers the normal foreground `.bin` CLI path only. The opt-in preset
  path is not evidence that manual `npm install vite && npm run dev` works.

## Reversibility

REVERSIBLE — a spawn-spec env addition or a loud-throw. No public API / disk format. An IRREVERSIBLE "bin children may host nested workers" capability decision would get its own ADR.
