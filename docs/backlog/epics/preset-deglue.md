---
kind: epic
status: ready
title: Preset de-glue — equivalent libs work like preset libs
created: 2026-07-02
value: A developer who swaps a preset library for an equivalent (vite → webpack-dev-server, express → fastify, esbuild → swc) keeps a working sandbox — LIVE/preview/HMR/install ride generic platform mechanisms, and every substitution or remaining gap is loud.
user_story: As a developer forking a preset, I want to replace its libraries with equivalents and keep the sandbox working, but today the dev-server lifecycle is keyed to the literal `vite` bin name, three packages are patched only at vite-preset boot, readiness is faked via `[vite]` stdout markers, and shadow-registry substitutions happen silently.
items: [playground/generic-dev-server-lifecycle, npm-client/install-time-shadow-shims, net/preview-websocket-bridge, net/sqlite-lazy-engine, playground/ts-ls-compiler-resolution]
---

## Outcome

Glue audit (2026-07-01) found all preset-specific glue concentrated in five spots: (1) `binNameOf(shimPath) === 'vite'` lifecycle dispatch + rifty-injected `[vite] … ready` stdout markers + vite-only reload-restore (`real-vite-bootstrap.ts`, `dev-server-boot.ts`); (2) boot-time `overlayShims()` patching rollup/esbuild/lightningcss internals at hardcoded `/workspace/node_modules` paths, vite preset only, plus silent `bakedOverrides` swaps; (3) HMR only via a vite-keyed `--config` wrapper + injected vite plugin (underlying platform gap: no loopback WebSocket in a browser); (4) `node:sqlite` engine gated on a preset flag (`cfg.sqlite`); (5) ts-LS hardcoded to the stock `typescript/lib/typescript.js` layout. Kernel/runtime and the rest of the npm pipeline are already generic (verified in the same audit). De-glue = move each mechanism to its platform boundary — port-listen events, install-time substitution with loud provenance lines, preview-side WS bridge, builtin-level engine init — so faithful-Node behavior stops depending on WHICH tool a preset happened to ship. Mission anchor: "real Node programs in the browser", not "these five packages".

## User scenario

A developer forks the vite preset and replaces vite with webpack-dev-server (or a bare `node server.mjs`), runs `npm i && npm run dev`: the terminal shows only tool-authored output, the LIVE pill + preview light up, HMR/WS works, page reload restores the running server. `npm install` output explicitly names every dependency substituted from the shadow registry. In a scratch project `npm i vite && npm run dev` works with zero preset machinery, and `require('node:sqlite')` works without any preset flag. Done when a non-vite-fork e2e is green and no `binNameOf === 'vite'` / boot-overlay branch remains.

## Items

Order: lifecycle → install-shims → WS bridge (big lift, needs ADR); sqlite + ts-LS independent.

- `playground/generic-dev-server-lifecycle` — port listen/close events drive LIVE + preview + reload-restore for any server; fake `[vite]` markers deleted. Kills the silent-breakage class. (ready)
- `npm-client/install-time-shadow-shims` — internals shims move from vite-preset boot to install time (any project, any layout); every shadow-registry substitution printed loudly. (ready)
- `net/preview-websocket-bridge` — generic loopback WS for the preview frame; deletes the vite `--config` wrapper + HMR plugin, the last vite-keyed branch. (draft → needs ADR)
- `net/sqlite-lazy-engine` — `node:sqlite` available to any project; `cfg.sqlite` preset flag deleted. (draft — engine-init boundary fork open)
- `playground/ts-ls-compiler-resolution` — resolve the workspace `typescript` via package exports/main, keep the loud API-surface check. (ready)
