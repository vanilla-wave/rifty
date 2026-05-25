# ADR 0031: Every SW↔main wire frame carries `version`, receivers validate at decode

Status: Implemented (2026-05-25) — `packages/service-worker/src/{preview-bridge,route-preview,protocol}.ts`
Date: 2026-05

## Context

ADR-0016 introduced `SW_PROTOCOL_VERSION` and the rule "either side refuses to honour a mismatched peer". The first implementation honoured that for the handshake frames (`ping`/`pong`, `preview:ready`/`preview:goodbye`), but two follow-up gaps surfaced in review:

1. **Main thread did not validate the data frame.** The `SW_PREVIEW_REQUEST` frame is stamped with `version` on the way out, but the receiving `setupPreviewBridge` listener never checked it before dispatching to the user-supplied `PreviewHandler`. A version-skewed pair (old page + fresh SW, or vice-versa after `skipWaiting()`) silently invoked the wrong-shape handler. The protocol's promise — "mismatch → refuse, never half-honour" — was not kept for the data path.
2. **The SW routed by `clients.matchAll()[0]` instead of the in-flight `clientId`.** With multiple controlled windows (e.g. preview iframe + dev page), `matchAll()[0]` resolves whichever window the SW happens to enumerate first. The `/preview/<port>/*` fetch then gets handed to a window that may not own the relevant net registry, dropping the response on the floor (502/timeout). This is independent of versioning but lives on the same bridge and gets fixed in the same pass — its absence was the symptom that exposed the version-validation gap.

REVIEW_ACTIONS A-017 ratified ADR-0016 (SW source-of-truth) but did not enumerate the framing/version sub-requirements. This ADR fills that gap and supersedes ADR-0016's looser "either side refuses" wording with an explicit per-frame contract.

## Decision

**Per-frame versioning.** Every wire frame across the SW↔main `postMessage` channel carries a `version: string` field set to `SW_PROTOCOL_VERSION`. Receivers MUST validate `data.version === SW_PROTOCOL_VERSION` at the top of the dispatch path, before any side effect.

On mismatch:
- The receiver MUST NOT invoke the user handler / state-machine transition / response-port write that the frame intended.
- The receiver MUST reply (when the frame solicits a reply) with a structured error:
  ```ts
  { kind: 'PROTOCOL_VERSION_MISMATCH', expected: '<our>', got: '<peer>', message: '...' }
  ```
  exposed as `SW_ERROR_PROTOCOL_VERSION_MISMATCH` and `SwProtocolVersionMismatchError` from `@rifty/service-worker`.
- The SW MUST map a `PROTOCOL_VERSION_MISMATCH` error frame received from the main thread to an `HTTP/503` response (consistent with handshake mismatch which already 503s).
- The receiver MAY log a one-shot warning per offending peer for observability, deduplicating with a `Set<clientId>` so a stuck client cannot flood the console.

**Version bumps are SemVer-major for the SW frame shape.** Any breaking change to a frame's field set, type, or semantics requires bumping `SW_PROTOCOL_VERSION`. Additive optional fields with a documented default DO NOT require a bump — the receiver treats `undefined` as the default. This mirrors how `Content-Type` carries `; charset=` without invalidating older parsers.

**Routing by `event.clientId` on the SW side.** The SW prefers `event.resultingClientId || event.clientId` and calls `self.clients.get(id)` to obtain the owning window client. Only when both ids are empty (navigation-preload edge cases; some browsers report empty ids for preload requests) does the SW fall back to `clients.matchAll({ type: 'window', includeUncontrolled: false })[0]` — and that branch emits a one-shot `console.warn` per scope so the misroute path is visible in production.

This routing rule is technically orthogonal to versioning but is co-located in this ADR because (a) both fix the same bridge module in the same pass and (b) without proper routing, even a well-versioned frame is sent to the wrong owner.

## Consequences

- A drifting peer is detected on the first data frame instead of silently producing wrong-shaped responses. The error is structured and machine-readable (`error.kind === 'PROTOCOL_VERSION_MISMATCH'`), so callers can branch on it (e.g. the playground can show a "reload to update the worker" banner).
- The "first window wins" routing bug is fixed in the same change. A multi-window dev session (e.g. preview pane + storybook iframe) no longer scrambles `/preview/*` responses.
- Negative: per-frame validation costs one string comparison per dispatch — negligible. The fallback warn adds a one-shot console line per scope, accepted as the price of observability.
- Negative: the bridge module split (`preview-bridge.ts` → `preview-bridge.ts` + `route-preview.ts`) widens the public surface by one type re-export (`SerializedRequest` now lives in `protocol.ts`). Both modules stay under the ADR-0024 file-size budget.
- Follow-up: the same pattern (per-frame `version` + structured `PROTOCOL_VERSION_MISMATCH` reply) should be applied to any future SW-channel additions. New frames added in later ADRs (e.g. an eventual `preview:stream-cancel`) MUST include the `version` field and the receiver MUST validate.

## Cited ADRs

- **ADR-0016** — Service Worker source-of-truth lives in `@rifty/service-worker`. Introduced `SW_PROTOCOL_VERSION` and the "either side refuses to honour a mismatched peer" rule. This ADR tightens that rule to apply on every frame, not just handshake.
- **ADR-0024** — File-size budget. The bridge split was driven by the 300-line cap; both `preview-bridge.ts` and `route-preview.ts` come in under it.
