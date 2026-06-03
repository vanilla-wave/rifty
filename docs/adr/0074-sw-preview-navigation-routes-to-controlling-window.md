# ADR 0074: SW preview routing — requests from the preview iframe resolve the owner from the controlling window, not the frame's own client

Status: Accepted (2026-06-04)
Date: 2026-06-04
Supersedes: the owner-resolution preference in ADR-0031 ("prefer `event.resultingClientId || event.clientId`") for requests that originate inside a preview iframe. Refines ADR-0040's `SW_ROUTING_VERSION` owner-fallback contract wording and ADR-0046's binding wiring. Promotes and closes OPEN_QUESTIONS Q-2026-06-03-308 (the fix deferred by ADR-0073). Also fixes the dev-mode preview fixture's subresource path (`apps/playground/src/glue/devMode.ts`).

## Context

The Service Worker preview interceptor forwards `/preview/<port>/*` fetches to the realm that owns the registered in-process port — in M10 the playground **top-level window**, which runs `setupPreviewBridge` and posts `rifty:preview:ready`. The preview itself renders in a nested `<iframe src="/preview/<port>/">`. ADR-0031 had the interceptor pick the owner from `event.resultingClientId || event.clientId`.

That rule works for the page's own `fetch('/preview/3000/')` (what `m7-preview-sw.spec.ts` covers) but is wrong for **every request that originates inside the preview iframe** — and that gap is exactly what CI missed (m7 uses `page.evaluate(fetch)`, m10-hmr is skipped, the suite runs `pnpm dev`). The real client semantics — **measured live in Chromium** by instrumenting the SW (broadcasting `event.clientId` / `event.resultingClientId` / `request.mode` / `request.destination` to the page) — are:

| Request | `mode` | `destination` | `event.clientId` | `event.resultingClientId` |
| --- | --- | --- | --- | --- |
| Page warm-up `fetch('/preview/3000/')` | `cors` | `''` | **page** (bridge owner) | `''` |
| Iframe **navigation** to `/preview/3000/` | `navigate` | `iframe` | **`''` (empty)** | iframe's new client |
| Iframe **subresource** (e.g. `/preview/3000/src/main.js`) | `no-cors`/… | `script`/… | **iframe client** | `''` |

So for an iframe navigation `event.clientId` is **empty** (not the parent — that was the workflow's wrong assumption), and `resultingClientId` is the iframe's about-to-exist client. For an iframe subresource the client is the (now-committed) iframe. **In both cases the resolved client is the iframe, which never runs `setupPreviewBridge`, never posts `rifty:preview:ready`, and owns no port.** The readiness handshake (`ready-clients.ts`) targets a client that never handshakes → 3 s timeout → `route-preview.ts` returns 503 → the iframe navigation aborts with `net::ERR_ABORTED` and stays on `about:blank`; subresources 404/503 so the in-frame app never boots.

ADR-0073 made `PreviewPanel` report this honestly (poll-then-check-commit, show `unavailable` not a blank "live") and deferred the real fix to Q-2026-06-03-308. This ADR is that fix.

### Ruled out (not the cause)

- **Response shape / streaming body.** `route-preview.ts` builds `new Response(body, init)` from a `ReadableStream` — a valid navigation `BodyInit`. **Confirmed in-browser:** once the request routes to the bridge, the streamed response commits in the iframe and renders. The abort happens during owner resolution + handshake, before any body is synthesised.
- **COEP/CORP/X-Frame-Options/CSP.** `route-preview.ts` sets `Cross-Origin-Resource-Policy: cross-origin` + `Cross-Origin-Embedder-Policy: credentialless`, no `X-Frame-Options`, no `frame-ancestors`. Same-origin framing isn't blocked; verified by the iframe rendering once routing is fixed.

The cause is unambiguously **owner resolution sending preview-frame requests to the frame's own client instead of the controlling window**.

## Decision

**Every request that originates inside the preview iframe — the document navigation (`request.mode === 'navigate'`) and each of its subresources (a non-empty `request.destination`, e.g. `script`/`style`/`image`) — resolves its owner from the controlling top-level window, not from the request's own client id. The page's own bare `fetch('/preview/…')` (empty `destination`, non-navigation) keeps ADR-0031's `resultingClientId || clientId` preference unchanged.**

The change is the client-id the interceptor hands to the binding (`preview-bridge.ts`, `createPreviewInterceptor`'s `fetchHandler`):

```ts
// A preview renders inside a nested <iframe>, but the bridge that owns the
// port always lives on the controlling top-level window, never on the iframe.
const fromPreviewFrame =
  event.request.mode === 'navigate' || event.request.destination !== '';
const clientId = fromPreviewFrame
  ? null // drop the iframe's (empty/own) id → resolver falls back to the controlling window
  : event.resultingClientId || event.clientId || null; // ADR-0031, unchanged
```

Passing `null` makes `FirstWindowOwnerResolver` take its existing first-controlled-window fallback (`owner-resolver.ts`), which is the window that ran `setupPreviewBridge` — the bridge owner. The handshake completes; `routePreview` dispatches; the navigation **commits in-frame** and subresources serve.

Why this split is correct:

- **Iframe navigation** — `event.clientId` is empty and `resultingClientId` is the not-yet-existent iframe; neither is a bridge owner. Dropping both and falling back to the controlling window is the only correct target. At navigation time the iframe client doesn't exist yet, so `matchAll({type:'window'})[0]` is the page.
- **Iframe subresource** — `event.clientId` is the committed iframe (no bridge). The non-empty `destination` distinguishes it from the page's bare `fetch()` (whose `destination` is `''`). Dropping the iframe id routes the subresource to the same controlling-window bridge, so `/preview/<port>/src/main.js` etc. serve from the dev server.
- **Page's own `fetch('/preview/…')`** — empty `destination`, not a navigation → keeps `resultingClientId || clientId`, so the m7 path and multi-window page-fetch routing are byte-for-byte unchanged.

This lives entirely in the SW interceptor. `PreviewOwnerResolver` / `PreviewOwnerBinding` signatures are untouched; `FirstWindowOwnerBinding`, `WorkerOwnerBinding` and every consumer compile and behave unchanged. The **worker-owner path is unaffected** — `WorkerOwnerBinding.resolveOwner` ignores `clientId` and routes purely by port — so when A-023/A-026 host the server in a Worker, preview-frame requests route to that Worker with no further change.

### Companion fix — dev fixture subresource path

The dev-mode preview fixture (`devMode.ts` `INITIAL_INDEX_HTML`) used `<script type="module" src="/src/main.js">`. The **absolute** path resolves to origin-root `/src/main.js`, escaping the `/preview/<port>/` scope (→ 404, never reaching the dev server). Changed to the **relative** `src="src/main.js"`, which resolves under the iframe's base to `/preview/<port>/src/main.js`, routes through the preview bridge (now fixed for subresources above), and serves the user's entry. This is what makes the live preview show edited output (and HMR reload), not just the static fixture `<h1>`.

### `SW_ROUTING_VERSION` stays `'1'`

ADR-0040 pins "the resolver fallback order" under `SW_ROUTING_VERSION`. This decision **does not bump** it:

- The **resolver's** fallback order is byte-for-byte unchanged (`clients.get(id)` → first-controlled-window, same warn-dedup). What changes is **which id the interceptor passes in** for a preview-frame request — upstream of the versioned contract, derived from the live `FetchEvent`, never on a wire frame, never validated in the handshake. Two peers cannot "drift" on it (`PROTOCOL_VERSION_MISMATCH`); the selection is SW-local and the page never sees it.
- Bumping would force every `setupPreviewBridge` consumer to reload in lockstep for a change that alters no frame they exchange — the false-coupling ADR-0040 split the constants to avoid.

`protocol.ts`'s `SW_ROUTING_VERSION` doc comment is clarified to note the interceptor's preview-frame-vs-page id selection is a separate, unversioned, SW-local concern recorded here. ADR-0040 is left untouched (immutable): its "the resolver fallback order" clause already refers to the resolver's own logic, which is unchanged.

## Robustness caveat (first-controlled-window)

The fix relies on `FirstWindowOwnerResolver`'s fallback returning the **bridge-owning** window. After the iframe commits it is *also* a window client, so `matchAll({type:'window'})[0]` could in principle be the iframe. In practice Chromium orders the focused top-level window first, and the navigation (when the iframe client doesn't yet exist) and subresources both resolved to the page in live testing. A fully robust resolver would prefer a window that has **posted `ready`** for the port (the iframe never does); that is a strictly-better follow-up (it also handles multi-window precisely) but out of scope for this minimal, verified fix. Tracked as a note on Q-2026-06-03-308.

## Alternatives considered

- **A — interceptor drops the frame's id for preview-frame requests (chosen).** Detect navigation (`mode`) or subresource (`destination !== ''`), pass `null`, reuse the resolver's first-window fallback. Minimal, backward-compatible, no resolver/binding/signature/wire change, no version bump. The navigation/subresource-vs-page-fetch split is the exact axis the bug lives on, and it's verified end-to-end in Chromium (iframe commits + renders + client JS runs).
- **A′ (rejected) — branch only on `mode === 'navigate'` and prefer `event.clientId`.** The first cut (from the diagnosis workflow). It assumed `event.clientId` is the parent window for an iframe navigation; **live instrumentation proved it is empty**, so this neither routes navigations correctly nor handles the iframe's subresources. Rejected after browser verification.
- **B — detect an iframe owner inside the resolver.** The resolver can't tell "iframe client, no bridge" from "window not yet handshaked" without re-introducing first-window-wins, and it changes the resolver contract `SW_ROUTING_VERSION` pins. Rejected.
- **C — return `null` when a non-empty `clientId` misses `clients.get`.** Converts a 3 s-timeout 503 into an immediate 503; the iframe still doesn't render. Not a fix.
- **D — revalidate the resolved owner against the ready-set in the binding.** Defensive over-engineering that would mask genuine not-yet-ready races. (A lighter version — "prefer a ready window in the fallback" — is the robustness follow-up above, not a blocker.)
- **E — serve the navigation straight from the SW (no page hop).** The long-term A-023/A-026 architecture once a Worker hosts the server. Out of scope; the worker binding already routes by port, so it needs no change here.

## Consequences

- (+) **In-frame preview now works under cross-origin isolation** — verified live: the iframe navigation commits, the dev server's HTML renders, the user's `/src/main.js` loads and runs (the `#app` populates, styles apply). The "Dev server + HMR" and "Real Vite" presets are now real, not just the four REPL presets.
- (+) `PreviewPanel` reports `live`; the ADR-0073 honest fallback remains the safety net for a genuinely-down server.
- (=) m7 subresource fetch path, multi-window page-fetch routing, worker-owner port routing, and the `SW_ROUTING_VERSION` handshake are unchanged — the new branch only fires for navigations or non-empty-`destination` requests.
- (−) Relies on the first-controlled-window fallback being the bridge owner (see robustness caveat); fine for the single-window playground, with a strictly-better ready-window-preferring follow-up noted.
- Follow-ups (tracked on Q-2026-06-03-308): a Playwright case driving a real `<iframe>` navigation (the coverage gap that let this ship); a `vite preview` prod-build CI smoke; optionally the ready-window-preferring resolver.

## Acceptance criteria

- [x] `createPreviewInterceptor`'s `fetchHandler` passes `null` (→ controlling-window fallback) for `mode === 'navigate'` or non-empty `destination`, and keeps ADR-0031's `resultingClientId || clientId` for the page's bare fetch.
- [x] Unit tests (`owner-resolver.test.ts`): iframe navigation (`clientId:''`, `resultingClientId:'iframe'`) routes to the bridge; iframe subresource (`destination:'script'`, `clientId:'iframe'`) routes to the bridge not the iframe; page bare fetch (`destination:''`) keeps clientId routing even when it isn't the first window.
- [x] Dev fixture uses a relative subresource path so the in-frame app boots.
- [x] Browser-verified in Chromium (Playwright MCP): iframe commits to `/preview/3000/`, renders "Hello from rifty", `#app` populated, body styled by the preset's JS, status pill "live".
- [x] m7 page-fetch e2e green; worker-owner parity green; no `SW_ROUTING_VERSION` / `SW_FRAME_VERSION` bump.
- [x] `@riftydev/service-worker` CHANGELOG entry; `protocol.ts` doc comment scoped (ADR-0040 left immutable); `PreviewPanel.tsx` comment + Q-2026-06-03-308 updated to "resolved by ADR-0074".

## References

- ADR-0031 — SW↔main wire-frame versioning; introduced the `resultingClientId || clientId` owner preference this ADR refines for preview-frame requests. Frame-versioning untouched.
- ADR-0040 — split `SW_FRAME_VERSION` / `SW_ROUTING_VERSION`; this ADR scopes its "resolver fallback order" clause to the resolver itself.
- ADR-0046 — `PreviewOwnerBinding` seam; worker binding routes by port, unaffected.
- ADR-0073 — playground UX overhaul; honest preview status; deferred this fix to Q-2026-06-03-308.
- OPEN_QUESTIONS.md — Q-2026-06-03-308, promoted and closed by this ADR.
