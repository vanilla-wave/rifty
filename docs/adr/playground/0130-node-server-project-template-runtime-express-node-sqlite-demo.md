# ADR 0130: Node-server project template runtime (Express + node:sqlite demo)

Status: Accepted
Date: 2026-06

> TL;DR: ProjectSpec (ADR-0078) becomes a discriminated union `vite | node-server`; node-server templates run their ENTRY as a long-running server program in the worker; first instance: `express-sqlite` fullstack demo (real express@4 from npm + `node:sqlite`/sql.js WASM, ADR-0065). Boot line is template-dispatched (`terminalDevLine`): vite → `vite`, node-server → `cd <root> && npm run dev` (cd-pinned: `npm run` reads package.json from the SESSION cwd, which persistence/user `cd` may have moved).

## Context

- Wanted: a client-server demo app in the playground — real Express + browser client + WASM DB — both a showcase and a whole-stack smoke test.
- ADR-0078 promised "a second runnable template is a data change", but the spec carried Vite-only knobs (`runtimeSpecifier`, `ServerSpec`, hmr), the worker bootstrap hardcoded `createServer(vite)`, and `preset.templateId` was DEAD data — App.tsx always booted `defaultProjectSpec()`.
- DB: `node:sqlite` (`DatabaseSync` over sql.js, ADR-0065) already ratified + tested in Node; never exercised in a browser worker realm.

## Decision

D1 — **ProjectSpec union.** `ViteProjectSpec | NodeServerProjectSpec` (discriminant `runtime`). Node variant: `extraFiles` (worker-seeded BEFORE the server starts — page-side preset sync is too late for the first preview request), `sqlite` flag (engine bring-up gate). No index.html seeded for node-server (would shadow the server's own HTML). `BootstrapConfig` mirrors the union.

D2 — **Worker bootstrap branch, common head.** Runtime globals / VFS bridges / seed / npm install / loader / `setProcessCwd(root)` (both runtimes agree with the project root; servers resolve `express.static('public')` from cwd) stay shared; tail dispatches on `cfg.runtime`. Node branch: optional sqlite engine init, Node-parity console over kernel stdio (console.log IS stdout — server logs reach the terminal; new `runtime-js` `./builtins/console` subpath export), `loader.import(entryPath)`, loud `waitForListeningPort` (no silent dead preview). HMR bridge + esbuild/rollup shims stay vite-only.

D3 — **sqlite engine in the worker: explicit `wasmBinary` + pinned `locateFile`.** Wasm fetched as a bundled same-origin asset (`sql.js/dist/sql-wasm.wasm?url`; D-001 — no CDN). `wasmBinary` skips emscripten's fs/fetch environment probing; `locateFile` must STILL be pinned — the glue computes the wasm path eagerly even with `wasmBinary`, and the engine default (`import.meta.resolve` on a bare specifier) throws in a bundled worker. `optimizeDeps.include: ['sql.js']` — lazy CJS discovery from a worker chunk made dev Vite full-reload the page mid-session.

D4 — **Boot line template-dispatched; `preset.templateId` wired.** `terminalDevLine(spec, root)`: `vite` | `cd <root> && npm run dev`; `devScriptCommand(spec)`: `vite` | `node src/main.js` (single source for package.json scripts AND the `npm run` matcher). App.tsx: reactive `activeTemplate()` follows `activePreset().templateId`; `runTerminalScript` routes the active template's dev script to the SAME lifecycle-owning command (`runViteCommand` → `startRealVite`); `vite` command refuses non-vite templates with a hint. Spawn env gains Node-idiomatic `PORT`.

Options rejected: (a) hidden `startRealVite` boot keeping `['vite']`-only — recreates the cosmetic-terminal split the original pins ban (worker not owned by a visible command); (b) top-level `node` terminal command — fakes general `node <file>` semantics, skips the real package.json script-resolution path `npm run dev` honestly exercises.

## Superseded recorded test pins (ratified revision — not relaxing tests for broken code)

- `App.test.ts` `['vite']` literals → `[terminalDevLine(activeTemplate())]` (boot + restart). Intent preserved: boot through the lifecycle-owning visible command, `['npm install', 'npm run dev']` theater still banned; literal bans retargeted to hardcoded lines bypassing the helper.
- `buildProjectPackageJson(template)` → `(activeTemplate())`; inline-package.json ban unchanged.
- npm-run routing pin extended: resolved node script body must reach `runViteCommand` via `devScriptCommand(activeTemplate())` (no second `'node src/main.js'` literal).
- `presets.test.ts` global `npm run dev` ban scoped per templateId: vite presets keep ban + `terminal prestarts vite`; node-server presets must not claim vite prestart. Same honesty invariant, per-runtime.
- `path.test.ts` `resolve('a','b') === '/a/b'` dropped: encoded the pre-fix `'/'` anchor; Node anchors at cwd (parity wins). Pinned by the new cwd-explicit case.

## Runtime bugs fixed en route (each TDD-pinned)

1. `net/sqlite/engine.ts` — Node detection ran INSIDE async bring-up; after `installProcessGlobals()` the rifty shim (has `versions.node`, lacks `getBuiltinModule`) made init throw deep in sql.js and the memoised promise never settled. Fix: capture `process.getBuiltinModule` at module-eval.
2. `runtime-js/builtins/path.ts` — `resolve()` anchored relative paths at `'/'`, not `process.cwd()` (fs already used cwd); broke `express.static('public')`.
3. `runtime-js/builtins/fs.ts` — `createReadStream/createWriteStream` were named ESM exports but missing from the default module object `require('fs')` returns (serve-static/send).
4. `net/http/response.ts` — fetch `Response` THROWS on any body for 204/205/304; `res.status(204).end()` (express DELETE) blew up dispatch. Null-body statuses now send `null`, no chunked framing.
5. `service-worker/route-preview.ts` — serialized POSTs lacked `content-length` (fetch Requests never expose it); re-derived from drained bytes.
6. `net/http/request.ts` — bodied requests with neither `content-length` nor `transfer-encoding` (browser strips the former on Request rebuild — forbidden header) now present honest `transfer-encoding: chunked`, so typeis-style `hasBody()` (express.json) reads the body.
7. In-iframe `fetch()` 503 (iframe clientId never handshakes; focus-ordered `matchAll` could pick the iframe as owner) — first exposed by this demo, fixed UPSTREAM in parallel by ADR-0097 (`previewFrameContexts` + ready-window preference, `SW_ROUTING_VERSION` 3); this branch's interim fix was dropped in favour of it on rebase. The demo e2e remains the end-to-end regression for that path.

## Consequences

- (+) Full in-browser client-server demo: npm install → Express → SW routing (GET/POST/PATCH/DELETE with bodies) → sql.js WASM → preview iframe UI. E2E spec `tests/e2e/fullstack-demo.spec.ts`; live integration `tests/integration/fullstack-demo-live-run.opt-in.test.ts`.
- (+) In-iframe `fetch()` now works — unblocks ANY previewed client-server app, not just the demo.
- (+) `preset.templateId` live; third template = data change for real this time.
- (−) Boot depends on the seeded package.json script — failures surface as visible terminal errors (acceptable: surfaced, not silent).
- (−) `'vite'`-literal grep no longer finds boot sites — grep `terminalDevLine`.
- Shipped alongside: `RIFTY_PLAYGROUND_PORT` env (vite + playwright configs) — parallel-worktree dev/e2e.
- Follow-ups: sqlite OPFS persistence (`docs/backlog/net/sqlite-opfs-persistence.md`) would let the demo survive restarts; no restart-on-edit for node servers (`docs/backlog/playground/node-server-restart-on-edit.md`); no bare `node <file>` terminal command (`docs/backlog/playground/terminal-node-command.md`); window-owner readiness was unauthenticated (closed by ADR-0160); transient port-flip window on cross-template preset switch (`docs/backlog/playground/preset-switch-port-flip-window.md`); opt-in live harness IPC noise (`docs/backlog/runtime-js/in-process-harness-vitest-ipc-noise.md`).

Refs: ADR-0065 (sql.js DatabaseSync), ADR-0078 (ProjectSpec), ADR-0040 (`SW_ROUTING_VERSION`), ADR-0097 (preview frame contexts), ADR-0123 (port-aware owner routing), D-001 (COI/no-CDN), D-004 (registry URL).
