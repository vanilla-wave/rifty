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

**DONE.**
Sync + async + promises fs over a unified VFS; OPFS + Memory backends. ADR-0014, ADR-0029, ADR-0037, ADR-0041, ADR-0072.

## M5 — Streams & IO

**DONE.**
Readable/Writable/Duplex/Transform/PassThrough, backpressure, async iterators, `pipeline`/`finished`. ADR-0034, ADR-0035, ADR-0069.

## M6 — Processes

**PARTIAL.**
`spawn`/`exec`/`execSync`/`fork`(IPC)/`worker_threads`; `ProcessManager` PID tracking. ADR-0011, ADR-0019, ADR-0045.
open:
- `docs/backlog/kernel/process-equals-web-worker` — real Worker per child (not in-realm `new Function`).
- `docs/backlog/kernel/binary-stdio-messageport-backpressure` — pipe stdio over `MessagePort` with backpressure.

## M7 — Network

**PARTIAL.**
`net`/`http` servers, `IncomingMessage` Readable, `http.request`/`http.get` loopback over the port registry plus fetch/WebSocket egress, SW preview round-trip, chunked streaming; real `express@4` runs end-to-end. Raw OS TCP connect APIs are a loud browser ceiling, not a fake socket. ADR-0010, ADR-0017, ADR-0048, ADR-0123, ADR-0154.

## M8 — WASI Runner

**PARTIAL.**
`@riftydev/runtime-wasi` preview1 syscalls + preopens over the shared mirror; exact package-sourced `@esbuild/wasi-preview1` runs end-to-end in conformance. ADR-0038, ADR-0049, ADR-0316.
open:
- `docs/backlog/runtime-wasi/wasi-vfs-unification-doc-test` — single-source-of-truth VFS↔WASI doc/test.
- `docs/backlog/runtime-wasi/unimplemented-syscalls-nosys` — `poll_oneoff` + remaining ENOSYS syscalls.

## M9 — npm install

**PARTIAL.**
Semver, RegistryClient, gzip+tar, linker, lockfile, shadow registry, nested install (first-wins-flat + nest-on-conflict) with lockfile replay; deployed prod registry proxy round-trip smoked in CI. ADR-0005, ADR-0006, ADR-0015, ADR-0021, ADR-0023, ADR-0027, ADR-0042, ADR-0051, ADR-0163.
open:
- `docs/backlog/npm-client/chalk-express-integration-fixtures` — chalk + full express real-tarball fixtures.
- `docs/backlog/npm-client/live-registry-roundtrip-smoke` — live `registry.npmjs.org` through the Vite proxy.
- `docs/backlog/npm-client/postinstall-scripts` — postinstall via child_process.

## M10 — Real Tooling

**PARTIAL.**
Mini Vite-equivalent dev server (fs.watch, in-process WebSocket/HMR, shell, SW preview bridge); real Vite runs in-process; registry-attested esbuild-wasm transforms TS/JSX; Vite-in-Worker; cross-realm HMR bridge; preview iframe root-relative routing. ADR-0043, ADR-0049, ADR-0050, ADR-0073, ADR-0075, ADR-0076, ADR-0077, ADR-0078, ADR-0079, ADR-0080, ADR-0097, ADR-0226, ADR-0316.
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
  guests + worker pools. The first-15-minute Node CLI path includes real Node 24 CommonJS eval
  identity: `node -e/-p` uses the physical supervised child with entryless argv, detached `[eval]`
  module identity, cwd resolution, ordered stdio, preview, signals, and exact shell status.
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
tools as plain pluggable functions. The agent loop ships as `@riftydev/agent` (ADR-0424,
published under ADR-0436); endpoint, keys and UI stay with the consumer, and rifty's
AI-agnostic capabilities (TS language service, git over VFS) serve it. Positioning:
`docs/research/open-webcontainers-alternative-2026-06.md`.
Delivered foundation: headless Pi agent over public Workbench/no-COI hosts,
lazy playground "+chat", three-lane42-run diagnostic. Consumer guide:
`packages/agent/README.md`; proof: `docs/backlog/distribution/reference/ai-agent-mode-closure-evidence.md`.
Delivered no-COI host kit: copyable SDK + agent composition shared by packed CI
and the benchmark; typed lifecycle/progress, policies, transcript, text transport
and registry install. Proof: `docs/backlog/distribution/reference/no-coi-agent-host-kit-close.md`.
Delivered coding comparison: four real origins, retained own-environment results/
uncertainty; eval-v18 result and classification. Runbook:
`tools/agent-bench/README.md`; result:
`tools/agent-bench/reports/summaries/2026-10-15-eval-v18-corrected/README.md`
(text core only, ADR-0532).
open:
- `docs/backlog/distribution/ai-agent-subagent-orchestration` — `task`/subagent orchestration over the embeddable loop.
- `docs/backlog/distribution/ai-ide-product-ui` — chat + streamed tool-call/diff/approve UI over the IDE-kit.
- `docs/backlog/toolchain-build/ts-language-service` — in-browser TS diagnostics/hover/defs over VFS (agent `typecheck` + editor squiggles).
- `docs/backlog/shell/git-command-isomorphic` — git over VFS (isomorphic-git) for git-aware tools.

## M13 — Sharing & import

**PROPOSED.**
The sharing layer ON TOP of multi-project management (ADR-0165). Multi-project itself (Starter →
durable Scratch → named Projects, switch = owner respawn, reset-to-Starter) lands under M11's
"Durable & portable" theme; M13 opens those projects up: user-authored **Starters** ("save project
as Starter"), **share-by-link**, and **importing** external projects/stands. ADR-0165 keeps the
export/import engine live (owner-resident, ADR-0146) and the baseline = re-derivable Starter bundle
artifact intentionally reusable for export-as-Starter — only the launcher/status-bar Export SURFACES
ship disabled with a `soon` pill until here. Maps to M12's AI-agent sandbox contract (a shared
project IS an agent stand).
open:
- `docs/backlog/epics/from-intent-to-running-project` — outcome-first launcher plus local/Git project ingress and an explicit install/run plan.
- `docs/backlog/distribution/export-project-as-starter-m13` — project bundle → Starter / share-by-link; reuses the ADR-0165 baseline artifact. Links `create-rifty-template`.

## M14 — Isolate host

**PARTIAL.**
A Node service runs a rifty guest in a V8 isolate (ADR-0557, ADR-0563): `@riftydev/isolate-host`,
a fresh isolated-vm isolate per call inside a pool of long-lived clean-env worker processes. Orchestration, pods,
hypervisor and deploy stay outside rifty; the consumer supplies the outer boundary
(`docs/public/trust-model.md` §Isolate host).
- A — done: `runCode(code)` → `{stdout, stderr, exitCode}` with `node -e` parity and limits —
  `packages/isolate-host`, ADR-0557 (PR #405); gaps in `docs/public/compat/isolate-host.md`.
- Guest export — done: `@riftydev/isolate-guest`, the guest bundle + bridge contract for custom
  embedders, unstable; `runCode` runs on it — ADR-0558 (PR #411); isolated-vm 6.2.0 and other
  embedders are declared ceilings in `docs/public/compat/isolate-host.md`.
- Worker pool — done: up to 4 calls per long-lived worker, neighbour-safe limits, lost-worker
  reruns; warm call 13 ms, 8 concurrent calls 414 MiB (was 137 ms, 1118 MiB) — ADR-0563 (PR #412).
- FS snapshot — done: the guest's whole FS as one versioned, template-bound blob; one pure-JS
  codec in the isolate and the consumer's realm; hostile bytes refused in one linear pass within a
  budget that bounds the trusted side's memory and time — ADR-0567 (PR #418, #422). Deferred as
  backlog: keeping `ino` (`distribution/isolate-host-fs-snapshot-keep-ino`), atomic restore over a
  live FS (`distribution/isolate-host-fs-snapshot-atomic-restore`), the heavier snapshot straight
  after a restore (`distribution/isolate-host-fs-snapshot-restore-then-snapshot-peak`); the
  16 383-unit name cap stays reachable from guest code until rifty refuses names over NAME_MAX
  (`vfs/file-names-over-name-max-accepted`).
- B — done: live sandbox — `createSandbox()` with host binary file ops, `exec` = `node <path>
  [args]` with `runCode`'s limits, one sandbox through write → run → error → fix (every run end
  keeps the sandbox; killed runs roll back), `snapshot()` / create-from-snapshot, `destroy()`
  after which no isolate of the sandbox runs and no operation still in flight resolves —
  ADR-0568, ADR-0567 codec (PR #419, #418). A run diverges from Node where `runCode` does, with
  extra files kept, the whole run rolled back, or an exit code not Node's (compat ⚠️, the lifecycle
  class). Open as backlog: a byte request frame (`distribution/isolate-host-binary-request-frame`),
  host-write cost O(state) (`distribution/isolate-host-sandbox-write-cost-per-state`), keeping a
  killed run's writes (`distribution/isolate-host-sandbox-killed-run-partial-writes`).
- Directions (not fitted): C — library template (`createSandbox({ template })`, a loud gap
  today); D — agent tool set over the host (sandbox `env`/`cwd`/`stdin`, shell syntax); E — guest
  Web API shim (URL, structuredClone, web streams, AbortController, EventTarget — requirements'
  shim list, ceilings in A; ESM entries need `URL` too); F — Node-faithful `node file.js`
  diagnostics (runtime-js, its own goal). Also: an `AbortSignal` option, a concurrency limit
  (semaphore) and per-tenant worker affinity in `runCode` — the consumer caps concurrency and
  separates tenants by process itself today.
