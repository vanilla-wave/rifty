# Roadmap

Internal milestone map (M0–M12). Detail lives in the cited ADRs; open work links to `docs/backlog/<area>/<slug>`.

## M0 — Foundation

**DONE.**
Monorepo + playground + Worker + SW + cross-origin isolation. ADR-0001, ADR-0002, ADR-0003, ADR-0007.

## M1 — JS Execution

**DONE.**
Worker REPL, console capture/streaming, `.reset` respawn, capabilities detection.

## M2 — Modules

**DONE.**
CJS + ESM on one resolver, live bindings, cycles, CJS↔ESM interop. ADR-0004, ADR-0009.

## M3 — Node Core

**DONE.**
`path`/`events`/`util`/`querystring`/`url`/`assert`/`buffer`/`process`/`timers`; event-loop order. ADR-0026, ADR-0030.

## M4 — FileSystem

**PARTIAL.**
Sync + async + promises fs over a unified VFS; OPFS + Memory backends. ADR-0014, ADR-0029, ADR-0037, ADR-0041, ADR-0072.
open:
- `docs/backlog/vfs/opfs-persistence-browser-roundtrip` — write→reload round-trip in a real browser.

## M5 — Streams & IO

**DONE.**
Readable/Writable/Duplex/Transform/PassThrough, backpressure, async iterators, `pipeline`/`finished`. ADR-0034, ADR-0035, ADR-0069.

## M6 — Processes

**PARTIAL.**
`spawn`/`exec`/`execSync`/`fork`(IPC)/`worker_threads`; `ProcessManager` PID tracking. ADR-0011, ADR-0019, ADR-0045.
open:
- `docs/backlog/kernel/process-equals-web-worker` — real Worker per child (not in-realm `new Function`).
- `docs/backlog/kernel/binary-stdio-messageport-backpressure` — pipe stdio over `MessagePort` with backpressure.
- `docs/backlog/kernel/worker-per-process-residuals` — per-process cwd + residual worker-process wiring.

## M7 — Network

**PARTIAL.**
`net`/`http` servers, `IncomingMessage` Readable, `http.request` over fetch, port registry + SW preview round-trip, chunked streaming; real `express@4` runs end-to-end. ADR-0010, ADR-0017, ADR-0048.
open:
- `docs/backlog/service-worker/sw-to-worker-direct-routing` — SW→Worker (bridge terminates in the main-thread realm today).
- `docs/backlog/net/real-tcp-socket-semantics` — real-TCP `net.Socket` (HTTP-only today).
- `docs/backlog/net/cross-realm-websocket-bridge` — iframe HMR client over a real `WebSocket`.

## M8 — WASI Runner

**PARTIAL.**
`@riftydev/runtime-wasi` preview1 syscalls + preopens over the shared mirror; `@esbuild/wasi-preview1` runs end-to-end. ADR-0038, ADR-0047, ADR-0049.
open:
- `docs/backlog/runtime-wasi/wasi-vfs-unification-doc-test` — single-source-of-truth VFS↔WASI doc/test.
- `docs/backlog/runtime-wasi/unimplemented-syscalls-nosys` — `poll_oneoff` + remaining ENOSYS syscalls.

## M9 — npm install

**PARTIAL.**
Semver, RegistryClient, gzip+tar, linker, lockfile, shadow registry, nested install (first-wins-flat + nest-on-conflict) with lockfile replay. ADR-0005, ADR-0006, ADR-0015, ADR-0021, ADR-0023, ADR-0027, ADR-0042, ADR-0051.
open:
- `docs/backlog/npm-client/prod-npm-registry-proxy` — prod registry proxy (ADR-0028 reopened, Q-2026-05-24-007).
- `docs/backlog/npm-client/chalk-express-integration-fixtures` — chalk + full express real-tarball fixtures.
- `docs/backlog/npm-client/live-registry-roundtrip-smoke` — live `registry.npmjs.org` through the Vite proxy.
- `docs/backlog/npm-client/postinstall-scripts` — postinstall via child_process.

## M10 — Real Tooling

**PARTIAL.**
Mini Vite-equivalent dev server (fs.watch, in-process WebSocket/HMR, shell, SW preview bridge); real `vite@5.4` runs in-process; esbuild.wasm TS/JSX transform; Vite-in-Worker; cross-realm HMR bridge. ADR-0043, ADR-0047, ADR-0049, ADR-0050, ADR-0073, ADR-0075, ADR-0076, ADR-0077, ADR-0078, ADR-0079, ADR-0080.
open:
- `docs/backlog/playground/real-vite-browser-e2e` — full worker+HMR+iframe+SW-routing flow in a cross-origin-isolated browser via Playwright.
- `docs/backlog/net/streaming-cross-realm-preview` — streaming (not buffered-only) cross-realm preview, ADR-0048.

## M11 — post-M10 follow-ups

**PARTIAL.**
Container for M6/M8/M9/M10 tech debt, not a new work phase. Landed: Vite-in-Worker (ADR-0043), nested install (ADR-0042), fork-IPC via Worker (ADR-0045), esbuild.wasm vendoring (ADR-0047), native-dep policy (ADR-0051).
open:
- `docs/backlog/service-worker/sw-to-worker-direct-routing` — A-023 / Q-2026-05-27-002.
- `docs/backlog/net/streaming-cross-realm-preview` — buffered→streaming upgrade.
- `docs/backlog/npm-client/prod-npm-registry-proxy` — lockfile reuse + prod proxy residue.

## M12 — opencode server facade

**PROPOSED.**
Run anomalyco/opencode's Effect HTTP server headlessly up to the tool-execution ceiling; opencode NOT vendored. No-vendored-tree slice DONE (TS-on-import, Effect↔node:http, SSE-over-HTTP, F09 marker). ADR-0052, ADR-0053, ADR-0054, ADR-0055, ADR-0065.
open:
- `docs/backlog/opencode/m12-vendor-opencode-tree` — vendor opencode (F01), gates the rest.
- `docs/backlog/opencode/spike-c-createroutes-layer-build` — Spike C layer-build (decided WASM-SQLite P2).
- `docs/backlog/opencode/db-pty-wasm-sqlite-drizzle` — `#db`/`#pty` + WASM-SQLite (ADR-0065) + drizzle.
- `docs/backlog/opencode/headless-boot` — headless boot (F06).
- `docs/backlog/opencode/phase3-live-llm-roundtrip` — LLM round-trip + `node:https`→fetch.
