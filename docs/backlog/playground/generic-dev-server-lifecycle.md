---
area: playground
status: ready
title: Generic dev-server lifecycle (kill vite bin-name keying)
created: 2026-07-02
why: LIVE pill / preview / reload-restore fire only when the executed bin is literally named `vite`, and readiness is signaled by rifty-injected `[vite] … ready` stdout markers — an equivalent dev server runs fine but the sandbox UI silently never notices
user_story: As a developer forking a preset, I want to swap vite for webpack-dev-server (or a bare `node server.mjs`) and still get LIVE + preview + reload-restore, but today the lifecycle is keyed to `binNameOf(shimPath) === 'vite'` so the swap silently breaks the UI.
epic: preset-deglue
blocked_by: []
sources: []
code: [apps/playground/src/workers/real-vite-bootstrap.ts, apps/playground/src/workers/dev-server-boot.ts, apps/playground/src/glue/realVite.ts, packages/net/src/registry.ts]
---

## Context

The generic signal already exists: `packages/net/src/registry.ts` dispatches `register`/`unregister` events on every guest `listen()`/close — but only inside the server's realm, and playground ignores it for lifecycle. Instead `real-vite-bootstrap.ts` keys everything on `binNameOf(req.shimPath) === 'vite'` (+ `viteCliMode` arg parsing): dev-server tracking, preview scope, `activeViteDevChild`. Readiness is faked by writing `[vite] dev server ready on port N` (dev-server-boot) / `[vite] preview ready on port N` (real-vite-bootstrap) into the terminal — lines the real tool never prints (fidelity violation) that e2e then greps. Reload-restore relaunches `runVitePreset` (vite-only). `node-server` presets get lifecycle via a separate `listPorts` poll.

## Acceptance

- Port lifecycle relayed child→owner→page as first-class events (`port:listen {port}` / `port:close`), sourced from the net registry's existing `register`/`unregister` — no polling, no bin-name or CLI-arg keying.
- LIVE pill + preview derive from the listening-port set: any guest server (vite, webpack-dev-server, bare `node:http`) reaches `data-state=running` and serves in the preview. `server.close()` → `port:close` → pill leaves `running`.
- e2e: preset fork whose dev script runs a NON-vite server → LIVE + preview green. This is the gate that proves genericity.
- Rifty-injected `[vite] dev server ready…` / `[vite] preview ready…` stdout lines removed; the terminal carries only tool-authored output; all e2e readiness asserts move to LIVE-pill/preview `data-state`, never marker strings.
- Reload-restore relaunches the recorded shell command of the running session (not `runVitePreset`) — the non-vite fork survives a page reload.
- `binNameOf(...) === 'vite'` remains ONLY in the HMR config-wrapper path (`withViteCliArgs`/`withViteCliEnv`), explicitly owned by `net/preview-websocket-bridge`; every other vite-keyed branch in `real-vite-bootstrap.ts` is deleted.
- All existing preset e2e stay green.

## Parity cases

- `npm run dev` (vite preset): terminal line-set contains no rifty-authored lines — matches what real Node vite prints (recorded-fixture comparison, platform gaps excepted).
- Bare `node server.mjs` with `http.createServer().listen(3000)`: LIVE + preview without any vite machinery; `close()` drops LIVE.
- express/koa/hono presets: the generic event replaces the `listPorts` poll with identical observable boot behavior.

## Out of scope

- HMR de-glue: the `--config` wrapper + injected vite plugin stay vite-keyed until `net/preview-websocket-bridge`; after this item they are the LAST vite-keyed spot.
- Multi-port preview chooser UX — current first/active-port selection behavior unchanged.

## Decisions

- Signal source = net registry events (already dispatched), relayed over the existing owner↔page channel that carries `pty:dev-server` today; both the vite IPC path and the node-server poll path are deleted, not wrapped. REVERSIBLE.
- e2e readiness contract = `data-state` attributes, never stdout markers (fidelity: rifty writes no fake tool output).
- Vite-specific fast paths allowed later only ON TOP of the generic signal, never instead of it.
