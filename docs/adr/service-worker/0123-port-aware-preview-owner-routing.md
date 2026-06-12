# ADR 0123: Port-aware preview owner routing

Status: Accepted
Date: 2026-06-11

> TL;DR: `/preview/<port>` resolves the controlling window first, then routes
> to a Worker only when that Worker claimed the same page owner token and port.

## Context

ADR-0046 added `PreviewOwnerBinding` for window and Worker owners but kept
`installPreviewInterceptor` on `FirstWindowOwnerBinding`. ADR-0043's Real Vite
path therefore still routed:

`SW -> page bridge -> BroadcastChannel -> Vite Worker`

The forcing consumer now exists: Real Vite owns a real port from a Worker. A
pure default flip to `WorkerOwnerBinding` would break page-owned Dev Mode, whose
bridge still lives in the window and sends no `ports`. A port-only Worker map
would also be wrong in multi-window sessions: a Worker from one playground page
could claim port `5174` and steal another page's same-port preview.

## Decision

Default preview routing becomes port-aware and owner-scoped:

- The controlled window advertises a stable `ownerToken` in
  `rifty:preview:ready` / `rifty:preview:goodbye`.
- Real Vite passes the same `ownerToken` to its Worker. The Worker advertises
  `setupPreviewBridge(..., { ownerToken, ports: [port] })`.
- The default `PortAwareOwnerBinding` resolves the controlling window first,
  reads that window's `ownerToken`, and lets a Worker win only for the matching
  `(ownerToken, port)` route key.
- If no matching Worker owns the requested port, routing falls back to the
  historical window bridge.
- Worker goodbye frames that name `ports` drop only those route keys; a full
  goodbye still drops the owner.
- The page-side Real Vite bridge remains for compatibility/version-skew and
  legacy window-owned paths.

`SW_FRAME_VERSION` stays `1`: `ownerToken` and `ports` are additive optional
fields. `SW_ROUTING_VERSION` bumps to `2` because owner selection semantics
changed on the wire: peers must agree that Worker port ownership is scoped by
the controlling window owner token.

## Consequences

- Positive: Real Vite preview can route `SW -> Worker` directly.
- Positive: same-port Workers in different playground windows cannot steal one
  another's preview requests.
- Positive: page-owned Dev Mode keeps working via window fallback.
- Negative: two bridge paths coexist until the page proxy is retired.
- Tests pin Worker-wins-with-same-token, cross-owner port isolation, window
  fallback, iframe nav/subresource owner routing, partial Worker goodbye, and
  heartbeat recovery after SW global restart.
- Follow-up: retire the page proxy only after deployed old-SW/new-page skew is
  no longer a concern.
