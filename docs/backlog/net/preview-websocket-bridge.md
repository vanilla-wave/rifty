---
area: net
status: ready
title: Close generic preview WebSocket parity proofs
created: 2026-07-02
why: the generic preview WebSocket bridge and wrapper retirement are delivered, but fallback-port publication, host-rejection settlement, and external-wss transparency still need browser proof
user_story: As a developer, I want stock HMR/WS from any dev server to work transparently in preview, including honest failures and native external wss egress.
epic: preset-deglue
blocked_by: [service-worker/preview-blocked-host-hang, playground/vite-strictport-fallback-proof]
sources: [docs/adr/net/0189-preview-loopback-websocket-bridge.md, docs/adr/service-worker/0123-port-aware-preview-owner-routing.md]
code: [packages/net/src/ws/browser-client-script.ts, packages/net/src/http/server.ts, packages/net/src/registry.ts, packages/workbench/src/workers/vite-cli-prep.ts, apps/playground/src/glue/hmr-bridge.ts]
---

## Context

ADR-0189's generic HTML injection, guest-port remap, and upgrade bridge are delivered. Installed Vite uses stock config; non-Vite socket-lab echo/close parity is green. The item stays open only for the browser proofs below.

### Phase state (2026-07-02)

DELIVERED (acceptance 1–3 + 5): generic marker-guarded HTML injection in `serveCrossRealmPreview`; guest-port remap in the injected client; foreign-URL-port upgrades; stock Vite HMR; and non-Vite socket-lab echo/close parity. Vite HMR rewrite/plugin env and curated dev-server invalidation are deleted; installed Vite observes the owner VFS through polling `fs.watch`.

RETIRED 2026-07-13: hidden Vite config wrappers and direct curated Vite boot are gone. Template policy is visible in user-editable `vite.config.js`; Vite args/config semantics belong to installed `.bin/vite`.

REMAINING: browser-prove fallback-port publication; diagnose the user-config host-rejection hang; add an external-`wss:` egress case. Template `optimizeDeps.noDiscovery` is visible policy, not hidden wrapper glue.

## Acceptance

- The preview HTML path injects the bridge client script into every `text/html` response (marker-guarded, head-prepend); the script bridges `ws:`/`wss:` URLs whose hostname is loopback or `location.hostname` to the GUEST port derived from the `/preview/<port>/` pathname prefix; non-loopback URLs keep native WebSocket.
- Vite preset HMR works with the wrapper's `server.hmr` rewrite + `createHmrBridgeVitePlugin` injection + `RIFTY_VITE_CLI_HMR`/`RIFTY_VITE_CLI_PORT` env DELETED (stock vite HMR config end-to-end): edit a file → preview updates, e2e-asserted.
- A NON-vite WS client works in the preview: e2e with a bare `ws` (or socket.io) echo server — the preview page's `new WebSocket('ws://localhost:<port>/…')` round-trips a message. Flip the socket-lab `browser-preview-websocket` matrix row to `supported` (its self-test is the in-preset gate).
- Remaining browser proofs close without reintroducing hidden Vite config or dispatch.
- All existing preset e2e stay green.

## Parity cases

- Stock `vite` dev with a USER `vite.config.js` carrying custom `server.hmr` (port only): behavior matches real Node vite semantics (config honored; bridge transparent).
- `ws` npm package echo server in the preview page: message round-trip + `close(code, reason)` propagates a faithful CloseEvent (existing close-event parity tests extend to the preview path).
- A `wss://` external URL in the preview keeps NATIVE WebSocket (no bridge interception of real egress).

## Out of scope

- Streaming HTML rewrite (buffered v1; follow-up only if measured).
- Send-queue backpressure parity with real `ws` under high volume — socket-lab keeps it loud.
- Non-HTML injection surfaces (SSE, worker scripts).

## Decisions

- All ratified in ADR-0189: injection at `serveCrossRealmPreview` response side; guest-port remap in the client script; phased wrapper retirement with per-option proofs; port-channel scoping (no token) for the preview path.
