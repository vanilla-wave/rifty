# ADR 0096: Port-aware preview owner routing

Status: Accepted
Date: 2026-06

> TL;DR: `/preview/<port>` resolves Worker-owned ports directly, else falls back to the window bridge.

## Context

ADR-0046 added `PreviewOwnerBinding` for window and Worker owners but kept
`installPreviewInterceptor` on `FirstWindowOwnerBinding`. ADR-0043's Real Vite
path therefore still routed:

`SW -> page bridge -> BroadcastChannel -> Vite Worker`

The forcing consumer now exists: Real Vite owns a real port from a Worker. A
pure default flip to `WorkerOwnerBinding` would break page-owned Dev Mode, whose
bridge still lives in the window and sends no `ports`.

## Decision

Default preview routing becomes port-aware:

- Worker owners that post `rifty:preview:ready` with `ports: [port]` win.
- If no Worker owns the requested port, route through the historical window
  binding.
- Real Vite's Worker mounts `setupPreviewBridge(..., { ports: [port] })` and
  dispatches SW requests to its worker-local port registry.
- The page-side Real Vite bridge remains for compatibility/version-skew and
  legacy window-owned paths.

No `SW_FRAME_VERSION` or `SW_ROUTING_VERSION` bump: `ports` was already an
additive optional field in ADR-0046. Routing precedence changes only inside the
current SW implementation.

## Consequences

- Positive: Real Vite preview can route `SW -> Worker` directly.
- Positive: page-owned Dev Mode keeps working via window fallback.
- Negative: two bridge paths coexist until the page proxy is retired.
- Tests pin worker-wins, window fallback, iframe nav/subresource owner routing,
  and heartbeat recovery after SW global restart.
- Follow-up: retire the page proxy only after deployed old-SW/new-page skew is
  no longer a concern.
