---
area: net
status: ready
title: Preview WS/HMR bridge termination — sockets error or close, never park
created: 2026-07-05
why: the WS bridge (ADR-0189) reuses the preview broker but has no termination fault rows — a dead server/worker must surface as socket close/error so vite client's own «server connection lost» UX can work; a parked-open socket freezes HMR silently
user_story: As a developer, I want HMR to show vite's own «server connection lost. polling for restart…» when the dev server dies, but today a mid-session worker death can leave the guest socket parked open — no banner, no reconnect, stale preview forever
epic: fault-honest-sw-preview
code: [packages/net/src/ws/browser-client-script.ts, packages/net/src/http/server.ts, packages/net/src/cross-realm/preview-port.ts]
---

## Context

ADR-0189: the injected client script remaps loopback WS to the guest port over BroadcastChannel frames (ADR-0048 protocol). Open/message/close-happy paths are delivered and parity-tested (`preview-websocket-bridge` phase state); TERMINAL semantics under faults (server gone, worker killed, channel dead) have no rows — the guest socket can stay open forever.

## Acceptance

One fault test per row (RED first):

- vite/user server closes the socket (`server.close`, `ws.close(code, reason)`) → guest CloseEvent with the faithful code/reason (happy-path parity exists — extend to close-under-load);
- owner worker killed mid-session → guest socket `close`/`error` within a bound, never parked-open; e2e: vite client shows «server connection lost. polling for restart…»;
- upgrade never completes (server died between HTTP accept and WS accept) → connection errors within a bound;
- dev server restarts → vite client's own reconnect succeeds (banner clears), no stale channel leftovers.

## Parity cases

- Real browser + vite: kill the dev server → client logs «server connection lost. polling for restart…», reconnects after restart — the preview guest shows the same observable sequence.
- Node `ws` client vs a killed server: abnormal-closure CloseEvent (1006 family) — the guest socket matches the event shape.

## Fault matrix

- `unbounded-read` × frames stop (worker dead) → close within a bound.
- `false-fallback` × upgrade never completes → error, not park.
- `torn-state` × half-closed (server FIN, worker alive) → close propagates both directions.

## Out of scope

- Egress (non-loopback) WebSocket — native, unit-pinned already.
- Send-queue backpressure — socket-lab keeps it loud (existing out-of-scope).
- SSE/long-poll transports vite doesn't use.

## Decisions

- Reuse the terminal-event reporting of `service-worker/preview-dispatch-termination-chokepoint` where the broker overlaps; WS-specific close-code mapping follows the pinned parity cases (Node `ws` + browser CloseEvent) — REVERSIBLE within those pins → CHANGELOG at impl.
