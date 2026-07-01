# ADR 0183: Scoped cross-realm preview responders

Status: Accepted
Date: 2026-06

> TL;DR: cross-realm preview requests may carry a run scope so stale same-port
> responders from older worker generations ignore them.

## Context

The cross-realm preview bridge is keyed by port: page-side
`bridgeCrossRealmPreview(port)` sends a request over `preview-port:<port>`, and
worker-side `serveCrossRealmPreview(port, ...)` replies. That matches the public
preview URL (`/preview/<port>/`) but lets two live worker generations listen on
the same BroadcastChannel during reload/restart windows.

Observed failure: after editing the TypeScript starter entry, the owner had the
new bytes and a fresh Vite transform existed, yet iframe reload could still
render the old starter UI. Trace showed the same `/preview/5174/src/main.ts`
request alternating between old-body, new-body, and `preview-port frame loss`
responses. That is not browser cache; it is stale responders racing the current
worker on the same port channel.

## Decision

- Extend the preview-port request frame with optional `scope: string`.
- `bridgeCrossRealmPreview(port, { scope })` includes the scope on requests.
- `serveCrossRealmPreview(port, dispatch, { scope })` replies only to matching
  scoped requests; non-matching requests are ignored.
- An unscoped responder ignores a scoped request too. A scope mismatch on either
  side means "not my run".
- Unscoped requests/responders keep the old behavior for compatibility and tests.
- Playground creates a fresh scope per preview-producing child run, passes it
  through spawn env / child ready IPC / preview registry, and wires the page
  bridge with that same scope.

## Consequences

- Same-port stale workers cannot answer the current preview iframe after a
  restart; the page URL and port model stay unchanged.
- The protocol stays additive: unscoped callers still work with unscoped
  responders, but scoped hosts get stale-responder isolation.
- Hosts that multiplex preview responders must propagate the same scope across
  their owner registry and page bridge.

## Tests

- `packages/net/src/cross-realm/preview-port.test.ts`
- `apps/playground/src/workers/preview-registry.test.ts`
- `apps/playground/src/glue/dev-server-ipc.test.ts`
- `apps/playground/src/glue/node-child-ipc.test.ts`
- `tests/e2e/ts-language-service.spec.ts`
