---
area: playground
status: ready
title: Vite 8 (Rolldown) via the real `vite` CLI — live e2e proof the foreground `.bin` child boots or loud-ceilings
created: 2026-07-07
why: PR #125 delivered the nested-worker plumbing for foreground `.bin` children (kernel/node-entry worker URLs forwarded AND consumed, fs relay installed), removing the known silent-hang cause for `npm install vite && npm run dev` on vite 8 — but no live Chromium e2e yet proves a terminal-installed `.bin/vite@8` dev server reaches ready (or fails with a named diagnostic) end-to-end.
user_story: As a user who runs `npm install vite && npm run dev` (getting vite 8), I want the dev server to either boot or refuse loudly with a diagnosis, not hang past the readiness window with a buried "same-realm fallback" warning.
sources: [docs/adr/runtime-js/0162-vite-8-rolldown-wasi-browser-boot-runtime-surface.md, docs/adr/shell/0150-supervised-child-processes-over-sab-sync-views-d-p6.md, docs/adr/playground/0161-vite-8-disables-hmr-pending-socket-parity.md]
code: [apps/playground/src/workers/owner-child-bin-executor.ts, apps/playground/src/workers/node-entry-bootstrap.ts, apps/playground/src/workers/dev-server-child-bootstrap.ts]
---

## Context

Two dev-server spawn paths exist. The **co-resident dev server** (Path A,
`createOwnerChildDevServer` → `dev-server-child-bootstrap`) has always forwarded
`RIFTY_KERNEL_WORKER_URL` + `RIFTY_NODE_ENTRY_WORKER_URL` so Rolldown's
`@rolldown/binding-wasm32-wasi` pthread pool can spawn — this is how the `vite8`
PRESET boots. The **foreground `.bin` executor** (Path B,
`createOwnerChildBinExecutor` → `buildChildSpawnSpec`) historically did not,
so a user's `npm install vite && npm run dev` (vite 8) fell back to same-realm
and hung silently.

PR #125 closed that cause end-to-end in unit terms: `buildChildSpawnSpec`
forwards both worker URLs (`owner-child-bin-executor.test.ts`) and the bin child
CONSUMES them (`setKernelWorkerUrl`/`setNodeEntryWorkerUrl` in
`node-entry-bootstrap.ts` — the forward alone was inert) plus installs the
nested-worker fs relay (`installRuntimeJsFsHandlers` backed by the remote view,
mirror of `dev-server-child-bootstrap`) so a spawned WASI pthread's first
`fs.statOrNull` doesn't crash the pool (`node-entry-bootstrap.test.ts`). Vite 7
is inert (no pool) — `tests/e2e/manual-vite-install.spec.ts` stays green.

`NAPI_RS_FORCE_WASI=1` is injected for ALL bin children as a platform truth, not
a Vite 8 knob: rifty can never load native `.node`, and forcing napi-rs onto its
WASI path turns "native binding missing" into a loud failure instead of a probe
maze. A user-set value wins (`req.env.NAPI_RS_FORCE_WASI ?? '1'`).

REMAINING contract: a live Chromium e2e that installs Vite 8 through the
terminal and asserts the foreground `.bin/vite@8` dev server reaches ready (or
throws a named terminal diagnostic) — the actual Rolldown WASI boot in a bin
child is not yet verified end-to-end.

## User scenario

A developer creates a normal package, runs `npm install vite` (resolving to Vite
8), then runs `npm run dev` or `vite --port 5174` through the terminal. The CLI
must either boot and publish the real selected port, or print a clear terminal
diagnostic that names the missing nested-worker capability. It must not sit past
readiness with only a buried same-realm `worker_threads` warning.

## Acceptance

- Browser e2e: install a Vite 8 package through the normal terminal path, run
  the real `.bin/vite` CLI, assert ready (LIVE/preview) or a named terminal
  diagnostic before the readiness window expires — never a silent timeout.
- If the e2e shows the forwarded pool still degrades, detect Rolldown's
  same-realm fallback and fail loudly in the terminal.
- The Vite 7 manual-install e2e stays green; no Vite 8-only BEHAVIOR divergence
  on the Vite 7 path (the platform-global `NAPI_RS_FORCE_WASI` default is not a
  divergence — it applies to every bin child and Vite 7 has no pthread pool).

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

- Add the vite-8-pinned boot-or-loud e2e (boot-only assertion — v8 HMR is off,
  ADR-0161 — so it cannot reuse the v7 manual-install HMR flow).
- If that e2e shows v8 still does not become ready, add a loud detection of
  Rolldown's same-realm degradation surfaced in the terminal before readiness.
- Invariant: no silent no-boot. A warning-then-hang violates the fidelity mission.

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

REVERSIBLE — an e2e plus, at most, a loud-throw. No public API / disk format. An IRREVERSIBLE "bin children may host nested workers" capability decision would get its own ADR.
