---
kind: epic
status: in-progress
title: Preset de-glue — equivalent libs work like preset libs
created: 2026-07-02
value: A developer who swaps a preset library for an equivalent (vite → webpack-dev-server, express → fastify, esbuild → swc) keeps a working sandbox — LIVE/preview/HMR/install ride generic platform mechanisms, and every substitution or remaining gap is loud.
user_story: As a developer forking a preset, I want to replace its libraries with equivalents and keep the sandbox working, but today the dev-server lifecycle is keyed to the literal `vite` bin name, three packages are patched only at vite-preset boot, readiness is faked via `[vite]` stdout markers, and shadow-registry substitutions happen silently.
items: [net/preview-websocket-bridge]
---

## Outcome

Glue audit (2026-07-01) found all preset-specific glue concentrated in five spots: (1) `binNameOf(shimPath) === 'vite'` lifecycle dispatch + rifty-injected `[vite] … ready` stdout markers + vite-only reload-restore; (2) boot-time `overlayShims()` patching rollup/esbuild/lightningcss internals at hardcoded paths, vite preset only, plus silent `bakedOverrides` swaps; (3) HMR only via a vite-keyed `--config` wrapper + injected vite plugin (underlying platform gap: no loopback WebSocket in a browser); (4) `node:sqlite` engine gated on a preset flag; (5) ts-LS hardcoded to the stock `typescript/lib/typescript.js` layout. Kernel/runtime and the rest of the npm pipeline were already generic (verified in the same audit). De-glue = move each mechanism to its platform boundary — port-listen events, install-time substitution with loud provenance lines, preview-side WS bridge, builtin-level engine init — so faithful-Node behavior stops depending on WHICH tool a preset happened to ship. Mission anchor: "real Node programs in the browser", not "these five packages".

## User scenario

A developer forks the vite preset and replaces vite with webpack-dev-server (or a bare `node server.mjs`), runs `npm i && npm run dev`: the terminal shows only tool-authored output, the LIVE pill + preview light up, HMR/WS works, page reload restores the running server (the recorded command replays). `npm install` output explicitly names every dependency substituted from the shadow registry. In a scratch project `npm i vite && npm run dev` works with zero preset machinery, and `require('node:sqlite')` works without any preset flag. Done when a non-vite-fork e2e is green and no `binNameOf === 'vite'` / boot-overlay branch remains.

## Items

Delivered (closed 2026-07-02; unit + full e2e lanes green):

- **generic dev-server lifecycle** — LIVE pill/preview/reload-restore derive from the guest listening-port set (net-registry events relayed child→owner→page; `preview-registry` is the single `pty:dev-server` authority); `[vite] … ready` markers deleted; reload replays the RECORDED dev command (owner-authoritative cwd); e2e gate `tests/e2e/generic-dev-server-lifecycle.spec.ts` (npm-run-dev fork + `server.close()` drop). (done → removed)
- **install-time shadow shims** — internals shims applied by the npm-client installer into the actual installed dirs, keyed `package@range` with companion pins (`@rollup/wasm-node`); unified single-content shims (dev stub deleted); EVERY shadow-registry substitution prints a "substituted from / patched from shadow registry" line on fresh install AND replay; out-of-range → loud `NotImplementedError`; playground boot-overlay deleted; snapshots rebaked. ADR-0188. Also subsumed `playground/vite8-prune-dead-shim-overlays`. (done → removed)
- **sqlite lazy engine** — sql.js brings up FULLY SYNCHRONOUSLY (`instantiateWasm` sync hook, worker-legal); builtin self-initializes at first `require('node:sqlite')` via a realm-installed sync wasm-bytes provider; `cfg.sqlite` preset flag + eager boot deleted. (done → removed)
- **ts-LS compiler resolution** — workspace `typescript` resolved via rifty's module resolver (exports/main, Node-parity-tested); loud API-surface check kept. (done → removed)

Open:

- `net/preview-websocket-bridge` — generic loopback WS for the preview frame; deletes the vite `--config` wrapper + HMR plugin, the last vite-keyed branch. Ground truth updated: guest-side `ws` upgrade already works (socket-lab `ws-server-local-upgrade` = supported); the gap is the iframe→guest duplex + injected `window.WebSocket` patch + per-forced-option wrapper retirement. (draft → needs ADR)
