# ADR 0097: Preview frame port context routes root-relative requests

Status: Accepted
Date: 2026-06-12

> TL;DR: once a preview iframe commits `/preview/<port>/`, the SW treats
> same-origin root-relative requests from that iframe client as preview traffic
> for the same port. This extends the routing contract carried by
> `SW_ROUTING_VERSION`.

## Context

ADR-0077 fixed the first Real Vite render by routing requests that originate
inside the preview iframe to the controlling window instead of the iframe's own
client. That was necessary for the document navigation to `/preview/<port>/` to
commit.

It was not sufficient for real applications. Vite's seeded HTML uses an
absolute module entry:

```html
<script type="module" src="/src/main.js"></script>
```

Inside the iframe, that root-relative URL resolves at the page origin, not under
`/preview/<port>/`. The current SW only intercepted paths matching
`/preview/<port>/...`, so the iframe loaded the fallback shell HTML, the module
entry never executed, and the opt-in Real Vite e2e saw an empty `#app` even
though the iframe itself was marked live.

Changing the seeded template to a relative script would only make the demo pass.
It would not represent how a real Vite app, lazy chunks, CSS assets,
`fetch('/api')`, or client-side navigations behave. ADR-0078 explicitly kept the
dev-mode relative HTML separate from the Real Vite template runtime for that
reason.

## Decision

The SW keeps a preview-frame port context:

1. When a navigation to `/preview/<port>/...` creates or reuses a preview frame
   client, record `iframeClientId -> port` using
   `FetchEvent.resultingClientId` when present, otherwise
   `FetchEvent.clientId`.
2. For subsequent same-origin requests whose `FetchEvent.clientId` is a known
   preview iframe client, route the request to the recorded port even when the
   URL path does not start with `/preview/<port>/`.
3. If such a request is a navigation that creates a new client
   (`resultingClientId` is present), carry the port context forward to the new
   iframe client id.
4. If a browser reload creates a new iframe client id without preserving the
   prior mapping, recover the port only from a same-origin
   `Request.referrer` that points at `/preview/<port>/`. Do not speculatively
   call `clients.get()` for arbitrary root-origin requests: unknown non-preview
   requests must fall through without `respondWith`.
5. Forward embedded iframe-context requests through the existing owner-binding
   path. The copied-top-level `/preview/<port>/` fallback is separate: it may
   route directly to the only live Worker for that port, but refuses ambiguous
   same-port Workers.

Direct `/preview/<other-port>/...` requests from a known preview iframe route
that one request to the explicit port but do not rebind the iframe's
root-relative context. Page-owned subresources such as
`<img src="/preview/5174/logo.png">` may route as explicit preview requests,
but they never record the page `clientId` as a preview-frame context.

`routePreview` still receives the synthetic upstream URL
`http://preview.local${pathname}${search}`. The change is only how a root-origin
iframe request becomes associated with a preview port.

This uses the routing contract pinned by ADR-0040. ADR-0123 bumped
`SW_ROUTING_VERSION` to `'2'` for owner-scoped Worker routing; this ADR bumps it
to `'3'` for iframe port context plus copied-top-level preview fallback.
`SW_FRAME_VERSION` stays `'1'` because no wire-frame field shape changes.
Number 0097 came from a scaffold gap and was accepted after ADR-0123 in the
same PR batch; it records the follow-up routing refinement.

The page's own root-origin fetches are not intercepted: without a known preview
iframe `clientId`, non-`/preview` URLs fall through normally.

## Consequences

- Real Vite's absolute `/src/main.js`, `/@vite/client`, lazy chunks, CSS
  assets, SPA navigations, and `fetch('/api')` requests can resolve through the
  same in-worker Vite server as the iframe document.
- The fix applies to complex apps without requiring project-specific rewrites
  or a relative-base workaround.
- A stale page or SW now trips the existing protocol-mismatch path because
  `SW_ROUTING_VERSION` differs. This is noisy by design; otherwise the page and
  SW could silently disagree about which origin-root requests are preview
  traffic.
- Owner precision is preserved for embedded previews. Copied top-level preview
  URLs remain intentionally ambiguous when multiple live Workers claim the same
  port under different owner tokens.
- The preview-frame context is SW-local and memory-only. A reload reconstructs
  it from the next `/preview/<port>/` iframe navigation, or from a following
  root-relative request's same-origin `/preview/<port>/` referrer. The current
  map is bounded by fixed-cap eviction; `docs/backlog/service-worker/preview-frame-context-lifecycle.md`
  tracks more precise lifetime cleanup.

## Cited ADRs and references

- ADR-0036 — preview URL addressing primitives.
- ADR-0040 — `SW_ROUTING_VERSION` pins addressing and owner-fallback semantics.
- ADR-0043 — original Real Vite page-owned routing background.
- ADR-0046 — `PreviewOwnerBinding` seam for future worker owners.
- ADR-0077 — preview iframe requests route to the controlling window owner.
- ADR-0078 — Real Vite templates intentionally use absolute entry URLs;
  dev-mode relative HTML is not the Real Vite contract.
- ADR-0123 — port-aware owner routing and direct SW-to-worker dispatch for
  Worker-owned preview ports.
