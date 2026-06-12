# Roadmap

Internal milestone map (M0–M12). Detail lives in the cited ADRs; open work links to `docs/backlog/<area>/<slug>`.

## M0 — Foundation

**DONE.**
Monorepo + playground + Worker + SW + cross-origin isolation. ADR-0001, ADR-0002, ADR-0003, ADR-0007.

## M1 — JS Execution

**DONE.**
Initial JS worker runner, console capture/streaming, resettable worker lifecycle,
capabilities detection.

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
`net`/`http` servers, `IncomingMessage` Readable, `http.request`/`http.get` loopback over the port registry plus fetch egress, SW preview round-trip, chunked streaming; real `express@4` runs end-to-end. ADR-0010, ADR-0017, ADR-0048, ADR-0123.
open:
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
Semver, RegistryClient, gzip+tar, linker, lockfile, shadow registry, nested install (first-wins-flat + nest-on-conflict) with lockfile replay; deployed prod registry proxy round-trip smoked in CI. ADR-0005, ADR-0006, ADR-0015, ADR-0021, ADR-0023, ADR-0027, ADR-0042, ADR-0051, ADR-0133.
open:
- `docs/backlog/npm-client/chalk-express-integration-fixtures` — chalk + full express real-tarball fixtures.
- `docs/backlog/npm-client/live-registry-roundtrip-smoke` — live `registry.npmjs.org` through the Vite proxy.
- `docs/backlog/npm-client/postinstall-scripts` — postinstall via child_process.

## M10 — Real Tooling

**PARTIAL.**
Mini Vite-equivalent dev server (fs.watch, in-process WebSocket/HMR, shell, SW preview bridge); real `vite@5.4` runs in-process; esbuild.wasm TS/JSX transform; Vite-in-Worker; cross-realm HMR bridge; preview iframe root-relative routing. ADR-0043, ADR-0047, ADR-0049, ADR-0050, ADR-0073, ADR-0075, ADR-0076, ADR-0077, ADR-0078, ADR-0079, ADR-0080, ADR-0097.
open:
- `docs/backlog/playground/real-vite-browser-e2e` — full worker+HMR+iframe+SW-routing flow in a cross-origin-isolated browser via a default/CI verification lane.

## M11 — Consumer Ready

**ACTIVE — the current focus.**
The adoption milestone: turn a capable core into something a tinkerer can actually stand up and
use comfortably. The wedge is *usage ergonomics*, not new runtime capability — the platform
ceilings are shared with WebContainers; rifty wins on being open, self-hostable, and auditable.
Theme (not a checklist):

- **Standable.** Install works off a real deploy, not just the dev proxy; a one-command scaffold
  emits the un-packageable host wiring (COOP/COEP, module-worker config, `sw.js` build, WASM copy,
  worker URLs). Day-1 adoption is a command, not hours of reverse-engineering.
- **Embeddable.** Headless controller/SDK surface beyond a JS REPL, and an AI-agent-shaped sandbox
  contract (create → write/read → `exec` streaming `{stdout,stderr,exitCode}` → preview URL →
  teardown + VFS snapshot/restore).
- **Runs real-ish projects.** Knock down the high-frequency runtime walls that steer ordinary npm
  code into hard failures (zlib, plausible `platform`/`arch`, fd-fs + `cp`/`mkdtemp`, http loopback);
  previews that don't hang (streaming preview frames, SW→Worker direct routing); off-main-thread heavy
  guests + worker pools.
- **Durable & portable.** `persist()`/quota, out-of-space UX, project export/import — the user's
  code survives reload and can leave the browser.
- **Trustworthy.** An honest, auditable open-licensing position vs the proprietary/metered/CDN-locked
  incumbents, and a compat-matrix presented as the pitch ("good enough for Express + Vite + npm
  install, fully open").

Contributing work is tagged **M11** across `docs/backlog/<area>/*` items (one-way by design: items
cite M11; this section deliberately does not enumerate them, so there is no list to drift). Grep
`M11` in `docs/backlog` for the live set. Consumer-ready follow-ups deliberately retargeted beyond
M11 are indexed in `docs/backlog/process-meta/consumer-ready-followup-cutline`.

## M12 — AI-First IDE for Node Projects

**PROPOSED — next after M11.**
The product layer: an in-browser AI coding agent for Node projects whose only external
dependency is an OpenAI-compatible endpoint. Builds on M11's AI-agent sandbox contract
(exec → preview → snapshot). Reclaims the M12 slot from the dropped opencode-facade
exploration (an aborted spike, never shipped) as the in-browser-agent direction —
opencode's tool layer needs native process spawn (a browser
ceiling) plus permanent vendoring; the agent is built instead on the embeddable **Pi**
harness (`@earendil-works/pi-agent-core`, verified browser-clean), registering rifty-native
tools as plain pluggable functions. **AI lives outside rifty** — a consumer of `@riftydev/*`;
rifty grows only AI-agnostic capabilities (TS language service, git over VFS). Positioning:
`docs/research/open-webcontainers-alternative-2026-06.md`.
open:
- `docs/backlog/distribution/ai-ide-pi-agent-harness` — embed Pi + the `pi-ai` openai subpath + rifty-tool bindings; records the Pi-over-opencode + AI-outside-rifty direction.
- `docs/backlog/distribution/ai-agent-subagent-orchestration` — `task`/subagent orchestration over the embeddable loop.
- `docs/backlog/distribution/ai-ide-product-ui` — chat + streamed tool-call/diff/approve UI over the IDE-kit.
- `docs/backlog/toolchain-build/ts-language-service` — in-browser TS diagnostics/hover/defs over VFS (agent `typecheck` + editor squiggles).
- `docs/backlog/shell/git-command-isomorphic` — git over VFS (isomorphic-git) for git-aware tools.
