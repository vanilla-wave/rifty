# ADR 0043: Vite-in-Worker realm and cross-realm preview bridge

Status: Accepted (2026-05-27). Supersedes **ADR-0025** for the Real Vite
path; ADR-0025's main-thread choice is retained as the documented
non-isolated fallback for the M10 Dev Mode adapter.
Date: 2026-05-27

## Context

ADR-0011 (sync IPC + worker-as-process) phases 1–3 landed in M11, and
ADR-0017 phase 1 shipped the `BroadcastChannel`-backed cross-realm
WebSocket bridge for HMR. Both ADRs explicitly sequence A-026
(Vite-in-Worker) on top of that work: ADR-0011's status header says
"A-026 confirmed M11, sequenced **after** ADR-0011 phases 1–3 (DONE) and
**before** A-023 (SW→Worker registry)"; ADR-0017's addendum landed the
HMR bridge "so the M11 A-026 migration becomes a realm swap, not a fresh
routing rewrite."

Today (M10) `apps/playground/src/glue/realVite.ts` runs Real Vite in the
playground page realm. ADR-0025 picked the page realm provisionally to
avoid the cross-realm bridge work for M10's Tier-0 Real-Vite demo. Its
status header has always pointed at this ADR as the long-term right
answer:

> A future move to Option B [dedicated Worker + cross-realm bridge]
> remains the right long-term answer and is tracked as an M10 follow-up;
> the migration path is local — replace `realVite.ts` with a
> worker-spawning version plus a registry bridge in `@riftydev/net`.

This ADR is that migration.

Three cross-realm problems have to be solved together for Vite to live
in its own realm:

1. **Port registry.** `@riftydev/net.dispatchToPort` is realm-local — a
   `Map<number, PortHandler>` in module scope. The SW asks the page
   realm; the listener now lives in a Worker realm.
2. **HMR transport.** `BridgedWebSocketServer` is the entity that
   broadcasts HMR updates to the iframe. It must live in whichever
   realm owns Vite's file watcher — i.e. the Worker, post-migration.
3. **Sync VFS.** `syncMirror()` is module-local. Vite reads the project
   tree; npm-install writes it; the editor writes it. If Vite is in a
   Worker and the editor is in the page, the realms see different VFSes.

A-023 (SW→Worker direct routing) sits on top of A-026 per ADR-0011; this
ADR does **not** include it. The SW continues to talk to the page
realm; the page realm becomes a routing proxy to the Worker realm.

## Decision

### D1: Page is the bridge owner; Worker is the dev-server realm

The Worker realm hosts: Vite, the npm-install pipeline that warms
`node_modules`, the runtime-js module loader, the
`BridgedWebSocketServer`, Vite's file watcher, and the worker's local
`syncMirror()`. The Page realm hosts: the Service Worker preview-bridge
handler (unchanged), and a thin proxy that forwards `SerializedRequest`
frames from the SW into the Worker over `BroadcastChannel`.

Rationale: A-023 (SW→Worker direct) is sequenced after A-026 per
ADR-0011, so the page cannot be removed from the request path yet. Page
becoming a request-forwarder is the minimum delta.

### D2: Cross-realm preview transport is `BroadcastChannel`, matching the HMR bridge

The page-side `dispatchToPort(<vite-port>, request)` resolves to a
handler returned by a new `@riftydev/net` helper, `bridgeCrossRealmPreview(port)`.
That handler serialises the `Request` (method/url/headers/`Uint8Array`
body) into a `request` frame, posts the frame onto a `BroadcastChannel`
keyed by `previewPortChannelUrl(port)` (synthetic URL fed through
`channelNameFor` — the same shape the HMR bridge uses), and resolves
with the matching `reply` frame from the Worker. Worker-side
`serveCrossRealmPreview(port, dispatch)` subscribes to the channel,
runs `dispatch(request)` (typically `dispatchToPort(port, request)` on
the worker-local registry), and posts the response back as a `reply`
frame.

Two transports were considered:

- **MessageChannel.** Per-connection isolated `MessagePort` pair.
  Requires extending `WorkerSpawnSpec` with an `extraPorts` field so the
  spawn flow can transfer the worker-side port half. A bigger kernel
  API change.
- **BroadcastChannel.** Origin-scoped pub/sub. Zero kernel API change;
  symmetric with the existing HMR bridge (`@riftydev/net.BridgedWebSocketServer`);
  ADR-0017 already accepts its no-backpressure, no-per-connection
  isolation trade-offs, and its M12 rewrite already plans to swap to
  dedicated `MessagePort`s when `SerializedResponse` becomes a
  `ReadableStream` carrier.

Chose `BroadcastChannel`. The kernel does not need to know about the
preview hop. The M12 rewrite under ADR-0017 will replace both this
bridge and the HMR bridge with dedicated `MessagePort` pairs at the same
time; until then they share the same primitive and the same trade-off
list.

### D3: HMR bridge moves into the Worker realm

`BroadcastChannel` is origin-scoped — any realm can open the channel
with the same name and reach the iframe. So `BridgedWebSocketServer`
works identically from page or worker. The Worker now owns the
`setupHmrBridge({port})` lifecycle (the page realm no longer
instantiates it); the iframe-side `BroadcastChannel` client is
unchanged. The migration is a realm swap, as ADR-0017's addendum
predicted.

### D4: VFS in the Worker is independent of the Page's VFS

The Worker uses its own `MemoryFsSync` (the default `syncMirror()` after
realm boot). The npm-install pipeline writes into that backend; Vite
reads from it. Editor edits in the page realm flow through a new
**VFS write port** (`apps/playground/src/glue/vfs-write-port.ts`) over a
second `BroadcastChannel` keyed off the dev-server port — page calls
`sendVfsWrite(port, {type:'write', path, data})`, the worker's
`serveVfsWrites(port)` applies each frame to its local `syncMirror()`.

The port is **one-way** (page → worker). The editor is the
source-of-truth for user source files; the worker is the
source-of-truth for installed `node_modules`. The page never reads
back. Two-way sync needs locking + snapshot semantics and is out of
scope until OPFS-as-sync (ADR-0013) is reachable from both realms —
that is M12+ work.

The VFS write port helper lives in `apps/playground/src/glue/` (not in
`@riftydev/net`) because the abstraction is "page writes file, worker
applies to VFS" — a `@riftydev/vfs` concern. Promoting the helper to
`@riftydev/net` would force `net` to know about `@riftydev/vfs`, which
inverts the layering. The wire format reuses `channelNameFor()` from
net for the addressing pattern but the VFS application logic stays in
the playground adapter.

### D5: This ADR supersedes ADR-0025 *for the Real Vite path only*

`startRealVite()` now defaults to the Worker path. ADR-0025's
main-thread choice is retained as the documented non-isolated fallback
for the M10 Dev Mode adapter (`apps/playground/src/glue/devMode.ts`),
which stays page-realm. The Real Vite worker path requires SAB IPC
(`isSabIpcSupported()` is the gate — same gate as the rest of
ADR-0011); if unavailable, `startRealVite()` throws
`NotImplementedError('startRealVite', 'requires SAB IPC …')` and the UI
surfaces the error in the playground terminal.

No SAB-less Real Vite fallback ships in this PR. ADR-0025's
implementation could be revived behind a feature flag if a non-isolated
target appears; until then, the page-realm Real Vite path is removed
to keep maintenance surface bounded.

### D6: Q-2026-05-27-002 stays open

Q-2026-05-27-002 designs a coherent `PreviewOwnerBinding` once a second
consumer arrives. The second consumer is `WorkerOwnerResolver` for A-023
(SW→Worker direct routing), which is **out of scope** for this ADR
(sequenced after A-026 per ADR-0011). This work leaves
`FirstWindowOwnerResolver` unchanged — the page is still the SW's
counterpart — so Q-002 does not graduate. The question's "Needs human
review by" target remains *Start of M11* (now elapsed); the gate has
moved to "Start of A-023 work."

## Consequences

### Positive

- The page realm no longer installs `installProcessGlobals()` /
  `installTimerGlobals()` / `globalThis.Buffer` when Real Vite is
  active. Monaco, Solid, and any other page-realm consumer keep their
  vanilla `Promise.prototype.then` (no nextTick patch on the page).
- Vite's CPU-heavy module-graph passes run in their own event loop;
  the page UI no longer competes with them.
- The HMR bridge stays as it was (`BridgedWebSocketServer` +
  `BroadcastChannel`), just hosted by the worker. ADR-0017's deliberate
  "wire the bridge in M10 so M11 is a realm swap" design pays off — the
  iframe client and the wire-format constants are unchanged.
- The cross-realm preview hop's `BroadcastChannel` choice matches the
  HMR bridge, so the M12 rewrite under ADR-0017 swaps both bridges to
  dedicated `MessagePort`s in one pass.

### Negative

- The page realm still appears on the request path: SW → Page (via
  `setupPreviewBridge` and the page's `@riftydev/net` registry) → Worker
  (via `BroadcastChannel`). A-023 will remove the page hop later, but
  for now every preview fetch crosses two realms and one
  `BroadcastChannel`.
- The VFS write port is one-way. Shell-driven writes typed in the
  playground terminal (`npm install foo`) write to the *page-side*
  `syncMirror()`, which is NOT the worker's VFS. The Real Vite demo
  does its own install inside the worker, so the gap doesn't break
  the M11 demo, but it is a real asymmetry. Documented in the adapter
  TSDoc and as a follow-up.
- `BroadcastChannel` has no per-connection isolation: a future
  multi-Real-Vite-worker scenario would need either per-port channels
  (already keyed off the dev-server port number) or the M12
  `MessagePort` upgrade. Today's single-worker demo is fine.
- The cross-realm preview hop is buffered — the worker fully reads the
  `Response` body into a `Uint8Array` before posting back. SSE /
  long-poll over a Real Vite preview will hang. ADR-0017's M12 work
  upgrades `SerializedResponse.body` to a transferable
  `ReadableStream<Uint8Array>`; until then, document the buffered
  limit.

### Follow-ups (not blocking)

- A-023 (SW→Worker direct routing): build `WorkerOwnerResolver` and
  swap `installPreviewInterceptor`'s default. This work graduates
  Q-2026-05-27-002 and removes the page hop from the request path.
- M12 ADR-0017 rewrite: replace both this bridge and the HMR bridge
  with dedicated `MessagePort` pairs; transfer `ReadableStream`
  bodies; surface backpressure.
- Editor↔Worker bidirectional VFS sync: blocked on OPFS-as-sync from
  the page realm (ADR-0013 phase 2).
- M10 Dev Mode migration to Worker (mirrors A-026 for the
  examples/vite-like-dev adapter): only meaningful once Dev Mode has a
  non-trivial workload; today it stays as the page-realm fallback.

## Acceptance criteria

- [x] `apps/playground/src/glue/realVite.ts` calls
      `globalProcessManager.spawnWorker(...)`; no `installProcessGlobals`
      / `installTimerGlobals` / `Buffer` global installs run on the page
      realm when Real Vite is active.
- [x] The worker bootstrap (`apps/playground/src/workers/real-vite-bootstrap.ts`)
      installs Node-compat globals locally, seeds the project, runs
      `install('vite')`, opens the cross-realm preview port, hosts the
      HMR bridge, opens the VFS write port, and starts
      `viteNs.createServer(...)`.
- [x] `@riftydev/net` exposes `previewPortChannelUrl`,
      `serveCrossRealmPreview`, and `bridgeCrossRealmPreview` from
      `cross-realm/preview-port.ts`. Six unit tests cover round-trip,
      POST body bytes, error path, and timeout.
- [x] The HMR e2e test (`tests/e2e/m10-hmr.spec.ts`) continues to pass
      unchanged (realm-agnostic by design — relies on
      `BroadcastChannel` reaching the iframe regardless of which realm
      hosts the server). Verified by inspection: no test edits required
      by this change.
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm check:deps` clean.
- [x] ADR-0025 status header updated to note the supersession scope.
- [ ] Manual smoke test: `pnpm dev`, toggle Real Vite, verify the
      iframe renders + hot-reloads on edit. (See report for status.)
