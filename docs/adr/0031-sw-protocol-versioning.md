# ADR 0031: Every SW↔main wire frame carries `version`, receivers validate at decode

Status: Implemented (2026-05-25) — `packages/service-worker/src/{preview-bridge,route-preview,protocol}.ts`
Date: 2026-05

## Context

ADR-0016 introduced `SW_PROTOCOL_VERSION` + the rule "either side refuses a mismatched peer". The first impl honoured this only for handshake frames (`ping`/`pong`, `preview:ready`/`preview:goodbye`). Two gaps surfaced in review:

1. **Main thread didn't validate the data frame.** `SW_PREVIEW_REQUEST` is stamped with `version` outbound, but `setupPreviewBridge` never checked it before dispatching to the user `PreviewHandler`. A version-skewed pair (old page + fresh SW after `skipWaiting()`, or vice-versa) silently invoked the wrong-shape handler — breaking the "mismatch → refuse, never half-honour" promise on the data path.
2. **SW routed by `clients.matchAll()[0]` instead of the in-flight `clientId`.** With multiple controlled windows (preview iframe + dev page), `matchAll()[0]` resolves whichever window enumerates first, so `/preview/<port>/*` may go to a window not owning the relevant net registry → dropped response (502/timeout). Orthogonal to versioning, but lives on the same bridge and was the symptom that exposed the version gap.

REVIEW_ACTIONS A-017 ratified ADR-0016 (SW source-of-truth) but didn't enumerate framing/version sub-requirements. This ADR fills that and supersedes ADR-0016's looser "either side refuses" wording with an explicit per-frame contract.

## Decision

**Per-frame versioning.** Every frame on the SW↔main `postMessage` channel carries `version: string` = `SW_PROTOCOL_VERSION`. Receivers MUST validate `data.version === SW_PROTOCOL_VERSION` at the top of dispatch, before any side effect.

On mismatch:
- Receiver MUST NOT invoke the user handler / state-machine transition / response-port write.
- When the frame solicits a reply, receiver MUST reply with a structured error:
  ```ts
  { kind: 'PROTOCOL_VERSION_MISMATCH', expected: '<our>', got: '<peer>', message: '...' }
  ```
  exposed as `SW_ERROR_PROTOCOL_VERSION_MISMATCH` + `SwProtocolVersionMismatchError` from `@riftydev/service-worker`.
- SW MUST map a `PROTOCOL_VERSION_MISMATCH` error frame from main to `HTTP/503` (consistent with handshake mismatch, which already 503s).
- Receiver MAY log a one-shot warning per offending peer, deduped via `Set<clientId>` so a stuck client can't flood the console.

**Version bumps are SemVer-major for frame shape.** Any breaking change to a frame's field set/type/semantics bumps `SW_PROTOCOL_VERSION`. Additive optional fields with a documented default DO NOT — the receiver treats `undefined` as the default (cf. `Content-Type; charset=`).

**SW routing by `event.clientId`.** SW prefers `event.resultingClientId || event.clientId` + `self.clients.get(id)`. Only when both ids are empty (navigation-preload edge cases) does it fall back to `clients.matchAll({ type: 'window', includeUncontrolled: false })[0]` — and that branch emits a one-shot `console.warn` per scope so the misroute is visible in production. Co-located here because both fixes touch the same bridge module in the same pass, and a well-versioned frame sent to the wrong owner is still broken.

## Consequences

- Drifting peer detected on the first data frame instead of silently wrong-shaped responses. Error is machine-readable (`error.kind === 'PROTOCOL_VERSION_MISMATCH'`) so callers can branch (e.g. playground "reload to update the worker" banner).
- "First window wins" routing bug fixed in the same change; multi-window sessions (preview pane + storybook iframe) no longer scramble `/preview/*` responses.
- Negative: per-frame validation = one string compare per dispatch (negligible); fallback warn adds a one-shot console line per scope, accepted for observability.
- Negative: bridge split (`preview-bridge.ts` → `preview-bridge.ts` + `route-preview.ts`) widens the public surface by one re-export (`SerializedRequest` now in `protocol.ts`). Both modules stay under the ADR-0024 file-size budget.
- Follow-up: future SW-channel frames (e.g. an eventual `preview:stream-cancel`) MUST include `version` and the receiver MUST validate.

## Cited ADRs

- **ADR-0016** — SW source-of-truth in `@riftydev/service-worker`; introduced `SW_PROTOCOL_VERSION` + "either side refuses a mismatched peer". This ADR tightens it to every frame, not just handshake.
- **ADR-0024** — File-size budget (300-line cap) that drove the bridge split; both files stay under it.
