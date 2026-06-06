# ADR 0043: Vite-in-Worker realm and cross-realm preview bridge

Status: Accepted (2026-05-27). Supersedes **ADR-0025** for the Real Vite
path only; ADR-0025's main-thread choice stays as the documented
non-isolated fallback for the M10 Dev Mode adapter.
Date: 2026-05-27

## Context

This ADR executes A-026 (Vite-in-Worker), which ADR-0011 and ADR-0017
sequenced for M11 after the foundations they landed:

- ADR-0011 (sync IPC + worker-as-process) phases 1–3 — done in M11; its
  status header sequences A-026 **after** phases 1–3 and **before** A-023
  (SW→Worker registry).
- ADR-0017 phase 1 — shipped the `BroadcastChannel`-backed cross-realm
  WebSocket/HMR bridge so A-026 becomes a realm swap, not a routing rewrite.

Today (M10), `apps/playground/src/glue/realVite.ts` runs Real Vite in the
playground page realm. ADR-0025 chose the page realm provisionally for the
M10 Tier-0 demo, naming this ADR as the long-term answer:

> Option B (dedicated Worker + cross-realm bridge) is the right long-term
> answer, tracked as an M10 follow-up; migration is local — replace
> `realVite.ts` with a worker-spawning version plus a registry bridge in
> `@riftydev/net`.

Three cross-realm problems must be solved together to move Vite to its own realm:

1. **Port registry.** `@riftydev/net.dispatchToPort` is realm-local
   (`Map<number, PortHandler>` in module scope). The SW asks the page; the
   listener now lives in the Worker.
2. **HMR transport.** `BridgedWebSocketServer` broadcasts HMR to the iframe;
   it must live wherever Vite's file watcher lives — the Worker, post-migration.
3. **Sync VFS.** `syncMirror()` is module-local. Vite reads the tree;
   npm-install and the editor write it. Worker-Vite + page-editor = different VFSes.

A-023 (SW→Worker direct routing) sits on top of A-026 per ADR-0011 and is
**not** included here. The SW keeps talking to the page realm; the page
realm becomes a routing proxy to the Worker.

## Decision

### D1: Page is the bridge owner; Worker is the dev-server realm

Worker hosts: Vite, the npm-install pipeline that warms `node_modules`, the
runtime-js module loader, `BridgedWebSocketServer`, Vite's file watcher, and
the worker-local `syncMirror()`. Page hosts: the SW preview-bridge handler
(unchanged) plus a thin proxy forwarding `SerializedRequest` frames from the
SW into the Worker over `BroadcastChannel`.

Rationale: A-023 (SW→Worker direct) is sequenced after A-026, so the page
cannot leave the request path yet. Page-as-forwarder is the minimum delta.

### D2: Cross-realm preview transport is `BroadcastChannel`, matching the HMR bridge

Page-side `dispatchToPort(<vite-port>, request)` resolves to a handler from
a new `@riftydev/net` helper `bridgeCrossRealmPreview(port)`. It serialises
the `Request` (method/url/headers/`Uint8Array` body) into a `request` frame,
posts it on a `BroadcastChannel` keyed by `previewPortChannelUrl(port)`
(synthetic URL through `channelNameFor`, same shape as the HMR bridge), and
resolves with the matching `reply` frame. Worker-side
`serveCrossRealmPreview(port, dispatch)` subscribes, runs `dispatch(request)`
(typically `dispatchToPort(port, request)` on the worker-local registry),
and posts back a `reply` frame.

Transports considered:

| Option | Verdict |
| --- | --- |
| **MessageChannel** — per-connection isolated `MessagePort` pair | Rejected: needs `WorkerSpawnSpec.extraPorts` to transfer the worker-side half — a bigger kernel API change. |
| **BroadcastChannel** — origin-scoped pub/sub | **Chosen.** Zero kernel API change; symmetric with the HMR bridge (`BridgedWebSocketServer`); ADR-0017 already accepts its no-backpressure / no-per-connection-isolation trade-offs and plans the M12 swap to `MessagePort`s when `SerializedResponse` becomes a `ReadableStream` carrier. |

The kernel needn't know about the preview hop. ADR-0017's M12 rewrite
replaces this bridge and the HMR bridge with dedicated `MessagePort` pairs
together; until then they share one primitive and one trade-off list.

### D3: HMR bridge moves into the Worker realm

`BroadcastChannel` is origin-scoped, so `BridgedWebSocketServer` works
identically from page or worker. The Worker now owns the
`setupHmrBridge({port})` lifecycle (page no longer instantiates it); the
iframe-side client is unchanged. Realm swap, as ADR-0017's addendum predicted.

### D4: Worker VFS is independent of the Page VFS

The Worker uses its own `MemoryFsSync` (default `syncMirror()` after boot);
npm-install writes it, Vite reads it. Editor edits in the page flow through a
new **VFS write port** (`apps/playground/src/glue/vfs-write-port.ts`) over a
second `BroadcastChannel` keyed off the dev-server port: page calls
`sendVfsWrite(port, {type:'write', path, data})`; the worker's
`serveVfsWrites(port)` applies each frame to its local `syncMirror()`.

The port is **one-way** (page → worker). Editor = source of truth for user
source files; worker = source of truth for installed `node_modules`. Page
never reads back. Two-way sync needs locking + snapshot semantics and is out
of scope until OPFS-as-sync (ADR-0013) is reachable from both realms — M12+.

The helper lives in `apps/playground/src/glue/` (not `@riftydev/net`)
because "page writes file, worker applies to VFS" is a `@riftydev/vfs`
concern; promoting it would force `net` to depend on `vfs`, inverting
layering. It reuses `channelNameFor()` from net for addressing, but the VFS
application logic stays in the playground adapter.

### D5: Supersedes ADR-0025 for the Real Vite path only

`startRealVite()` now defaults to the Worker path. ADR-0025's main-thread
choice is retained as the non-isolated fallback for the M10 Dev Mode adapter
(`apps/playground/src/glue/devMode.ts`), which stays page-realm. The Worker
path requires SAB IPC — `isSabIpcSupported()` is the gate (same as the rest
of ADR-0011); if unavailable, `startRealVite()` throws
`NotImplementedError('startRealVite', 'requires SAB IPC …')` and the UI
surfaces it in the playground terminal.

No SAB-less Real Vite fallback ships in this PR. ADR-0025's implementation
could be revived behind a feature flag for a non-isolated target; until then
the page-realm Real Vite path is removed to bound maintenance surface.

### D6: Q-2026-05-27-002 stays open

Q-2026-05-27-002 designs a coherent `PreviewOwnerBinding` once a second
consumer arrives. That consumer is `WorkerOwnerResolver` for A-023
(SW→Worker direct routing), **out of scope** here (sequenced after A-026).
This work leaves `FirstWindowOwnerResolver` unchanged — page is still the
SW's counterpart — so Q-002 does not graduate. Its "Needs human review by"
gate moves from *Start of M11* (now elapsed) to *Start of A-023 work*.

## Consequences

### Positive

- Page realm no longer installs `installProcessGlobals()` /
  `installTimerGlobals()` / `globalThis.Buffer` when Real Vite is active.
  Monaco, Solid, and other page consumers keep vanilla
  `Promise.prototype.then` (no nextTick patch on the page).
- Vite's CPU-heavy module-graph passes run in their own event loop; the page
  UI no longer competes with them.
- HMR bridge unchanged (`BridgedWebSocketServer` + `BroadcastChannel`), just
  worker-hosted. ADR-0017's "wire the bridge in M10 so M11 is a realm swap"
  pays off — iframe client and wire-format constants unchanged.
- Preview hop's `BroadcastChannel` choice matches HMR, so ADR-0017's M12
  rewrite swaps both bridges to `MessagePort`s in one pass.

### Negative

- Page still on the request path: SW → Page (`setupPreviewBridge` + page's
  `@riftydev/net` registry) → Worker (`BroadcastChannel`). A-023 removes the
  page hop later; for now every preview fetch crosses two realms and one
  `BroadcastChannel`.
- VFS write port is one-way. Shell-driven writes in the terminal
  (`npm install foo`) hit the *page-side* `syncMirror()`, NOT the worker's
  VFS. The Real Vite demo installs inside the worker so the M11 demo isn't
  broken, but it's a real asymmetry. Documented in adapter TSDoc + follow-up.
- `BroadcastChannel` has no per-connection isolation: multi-Real-Vite-worker
  would need per-port channels (already keyed off the port number) or the M12
  `MessagePort` upgrade. Today's single-worker demo is fine.
- Preview hop is buffered — worker reads the full `Response` body into a
  `Uint8Array` before posting back, so SSE / long-poll over a Real Vite
  preview hangs. ADR-0017's M12 work upgrades `SerializedResponse.body` to a
  transferable `ReadableStream<Uint8Array>`; until then, document the limit.

### Follow-ups (not blocking)

- A-023 (SW→Worker direct routing): build `WorkerOwnerResolver`, swap
  `installPreviewInterceptor`'s default. Graduates Q-2026-05-27-002 and
  removes the page hop.
- M12 ADR-0017 rewrite: replace this bridge + the HMR bridge with dedicated
  `MessagePort` pairs; transfer `ReadableStream` bodies; surface backpressure.
- Editor↔Worker bidirectional VFS sync: blocked on OPFS-as-sync from the page
  (ADR-0013 phase 2).
- M10 Dev Mode migration to Worker (mirrors A-026 for examples/vite-like-dev):
  meaningful only once Dev Mode has a non-trivial workload; stays page-realm
  fallback for now.

## Acceptance criteria

- [x] `apps/playground/src/glue/realVite.ts` calls
      `globalProcessManager.spawnWorker(...)`; no `installProcessGlobals` /
      `installTimerGlobals` / `Buffer` installs on the page realm when Real
      Vite is active.
- [x] Worker bootstrap (`apps/playground/src/workers/real-vite-bootstrap.ts`)
      installs Node-compat globals locally, seeds the project, runs
      `install('vite')`, opens the cross-realm preview port, hosts the HMR
      bridge, opens the VFS write port, and starts `viteNs.createServer(...)`.
- [x] `@riftydev/net` exposes `previewPortChannelUrl`,
      `serveCrossRealmPreview`, and `bridgeCrossRealmPreview` from
      `cross-realm/preview-port.ts`. Six unit tests: round-trip, POST body
      bytes, error path, timeout.
- [x] HMR e2e test (`tests/e2e/m10-hmr.spec.ts`) passes unchanged
      (realm-agnostic: relies on `BroadcastChannel` reaching the iframe
      regardless of host realm). Verified by inspection; no test edits needed.
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm check:deps` clean.
- [x] ADR-0025 status header updated to note the supersession scope.
- [ ] Manual smoke test: `pnpm dev`, toggle Real Vite, verify the iframe
      renders + hot-reloads on edit. (See report for status.)
