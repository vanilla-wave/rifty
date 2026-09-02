# ADR 0354: Preview WebSocket browser Origin propagation

Status: Accepted
Date: 2026-08
Relates to: ADR-0151, ADR-0189

> Correction (2026-08-11, ADR-0355): truthful Origin remains necessary, but a
> deployed webpack-dev-server also requires its exact page hostname in the
> project allow-list. Decision 3 forbids header rewriting and unbounded
> allow-lists, not that exact singleton policy.

> TL;DR: browser WebSocket opens carry the actual document Origin separately from target Host

## Context

The generic preview WebSocket shim sent target URL and protocols over its
BroadcastChannel, but dropped the browser handshake's `Origin`. `HttpServer`
therefore reconstructed `Host` from the target and no `Origin`; webpack-dev-server
5.2.6 rejects that otherwise-successful stock HMR connection. The iframe document
still has the outer browser origin; virtual HTTP routing does not change
`window.location.origin`.

Review lineage: Contract+RED attempt 1 blocked synthetic guest-port Origin and
URL-normalized programmatic Origin; both contradicted their browser/Node owners.

## Decision

1. Add optional `origin` to the public WebSocket bridge open frame. Browser preview
   publishers set it to the browser-owned `window.location.origin`; target URL remains
   the independent Host authority. Opaque browser origins retain the canonical `null`.
2. Programmatic WebSocket clients without an Origin keep it absent. A local
   `http.request` upgrade forwards an explicitly supplied Origin byte-for-byte,
   including Node's legal `Origin: null`; `HttpServer` does not reinterpret raw header
   policy owned by the caller.
3. Keep the mechanism generic. No tool detection, starter option, or allow-list
   bypass is admitted.

## Fault matrix

| Fault | Required observable result |
|---|---|
| browser open crosses the preview bridge | guest upgrade sees target Host plus actual `window.location.origin` |
| browser document has opaque origin | guest upgrade sees `Origin: null` |
| bridge open omits Origin | programmatic client remains origin-less |
| local `http.request` supplies Origin | exact raw Origin reaches the local upgrade |

## Consequences

- Stock security checks receive ordinary handshake provenance instead of requiring
  `allowedHosts` escape hatches.
- The additive frame field is optional, so existing non-browser publishers remain
  compatible.
