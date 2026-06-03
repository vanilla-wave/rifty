# ADR 0048: Streaming cross-realm preview wire-frame

Status: Accepted (promoted from Q-2026-05-29-001)
Date: 2026-05-29

## Context

`@riftydev/net.bridgeCrossRealmPreview` / `serveCrossRealmPreview`
(`packages/net/src/cross-realm/preview-port.ts`, ADR-0043 D2) bridge the page
realm's `dispatchToPort()` to a Worker-realm HTTP listener over a
`BroadcastChannel`. They were **buffered-only**: the worker read the entire
`Response` body into a `Uint8Array` (`await response.arrayBuffer()`) before
posting a single `reply` frame. Q-2026-05-29-001 flagged this — Real Vite's
vendor-prebundle and source-map responses overshoot one buffered frame, blowing
worker memory and first-byte latency. The SW↔page hop already streams; the
page↔worker hop did not.

This ADR was deliberated by a design panel + adversarial review. Three facts
constrain the design and **correct the working assumption that the bump is to
`SW_FRAME_VERSION`**:

1. **Layering.** `@riftydev/net` and `@riftydev/service-worker` are siblings (both
   depend only on `@riftydev/io`, which does not re-export `SW_FRAME_VERSION`). The
   preview bridge is wired entirely inside `@riftydev/net` + the playground worker
   bootstrap; the `PreviewPortFrame` never enters `@riftydev/service-worker` at
   runtime. Importing `SW_FRAME_VERSION` here would be a reverse/sibling import
   (a CLAUDE.md hard-rule violation) and would wrongly invalidate every SW↔page
   peer for a change to a different hop.
2. **Carrier fixed by standing ADRs.** ADR-0043 D2 and ADR-0017 jointly decide
   the preview bridge shares the HMR bridge's `BroadcastChannel` carrier, with
   no per-connection isolation/backpressure, and that BOTH bridges swap to
   dedicated `MessagePort`s in one M12 pass. Introducing `MessagePort` +
   pull-based backpressure now would be an IRREVERSIBLE decision against those
   ADRs.
3. **Versioning precedent.** ADR-0040 split the SW contract into
   `SW_FRAME_VERSION` / `SW_ROUTING_VERSION`; ADR-0031 mandates every wire frame
   carry its version and the receiver refuse a mismatched peer.

## Decision

### D1 — Net-local `PREVIEW_PORT_FRAME_VERSION`, bumped '1' → '2'

`@riftydev/net` gets its own version constant `PREVIEW_PORT_FRAME_VERSION`
(declared in `cross-realm/preview-port.ts`, re-exported from `src/index.ts`),
bumped `'1'` → `'2'`. It is the one-layer-down analogue of ADR-0040's
`SW_FRAME_VERSION`: it pins `PreviewPortFrame`'s shape and nothing else. The
addressing surface (`previewPortChannelUrl` → `channelNameFor`) is unchanged, so
no routing-version analogue is introduced. **`SW_FRAME_VERSION` is not bumped.**

### D2 — Four additive streaming frames; buffered `reply` retained as fallback

`PreviewPortFrame` gains `reply-stream-start`, `reply-stream-chunk`,
`reply-stream-end`, `reply-stream-error`; every frame carries `v`. The legacy
`request` / `reply` / `error` members are kept verbatim (a missing `v` decodes
as `'1'`), so the v='1' union is a strict subset of v='2'.

Worker (`serveCrossRealmPreview`) is **always-stream** (no size pre-probe): a
`null` body posts the legacy `reply{body:null}` fast path; any other body posts
`reply-stream-start`, then ordered `reply-stream-chunk{seq}` (≤ 64 KiB each),
then `reply-stream-end{seq:chunkCount}`. A throw during drain posts
`reply-stream-error{seq, message}`; a throw before the body is touched posts the
legacy version-unvalidated `error` frame so even a pre-ADR-0048 page understands
it.

Page (`bridgeCrossRealmPreview`) keeps a per-`requestId` accumulator, validates
strict `seq` monotonicity (gap → abort + 502 "frame loss"), concatenates on
`reply-stream-end` into one `Uint8Array`, and resolves a `Response`. **Page-side
worst-case memory is unchanged from the buffered path (accumulate-then-concat);
the win is worker-side memory + first-byte latency.** True end-to-end
`ReadableStream` is M12 (ADR-0017).

### D3 — Reply mode is chosen PER REQUEST, never pinned per channel

The worker reads `request.v` on **every** request frame and chooses that single
reply's mode: `v === '2'` with a non-null body streams; a missing/older `v`, or
a null body, takes the buffered `reply`. The page therefore stamps `v` on the
`request` frame, and the worker validates it.

This was the decisive adversarial correction to the panel's draft (which pinned
mode per channel from the first request). The worker **outlives page reloads**
(the realm holds the bridge for its lifetime); a per-channel pin set by a new
page A would still be in force when a *different*, possibly older, page B
reconnects to the same channel name mid-deploy — and an old page that receives
`reply-stream-*` frames doesn't just hang, it falls into its buffered-decode
branch and resolves a **silent wrong answer** (real status, empty body).
Per-request selection costs nothing (the `v` is already on the request) and
eliminates the hazard entirely, honouring ADR-0031's "degrade per peer, never
half-honour".

### D4 — Idle (no-progress) timeout, single map, unified cleanup

The page's per-request timer becomes a **no-progress** timer: armed on dispatch
and re-armed on every `reply-stream-{start,chunk}`. A live (even slow) stream
never trips it; a worker that dies mid-stream — the no-`pagehide`-on-worker case
(ADR-0046) — is reaped after `timeoutMs`. The stream accumulator lives **on the
single `pending` entry** (not a second map), so every terminal path
(end / error / seq-gap / timeout / dispose) frees it in one delete — no
partial-body leak.

## Consequences

- Worker memory + latency win for large bodies; page memory unchanged until M12.
- Always-stream adds two extra BroadcastChannel messages per small response
  (start+end vs one `reply`); negligible for file serving, and the null-body
  fast path covers the most common empty case.
- No true backpressure in M11 (ADR-0017 M12 envelope): a flooding worker against
  a stalled page event loop grows the internal BroadcastChannel buffer; bounded
  in practice (preview bodies are file-served, drain fast).
- `nextRequestId()` uses a per-realm counter + 6-char random tail; across a page
  reload the counter resets, so an old+new page briefly sharing a channel rely on
  the random tail to avoid cross-delivery. Acceptable today (birthday-bounded);
  noted as a risk to revisit if multi-consumer channels arrive before M12.
- If a reviewer wants `SW_FRAME_VERSION` to be the single source of truth across
  BOTH hops, the constant must first be lifted into `@riftydev/io` — a separate
  IRREVERSIBLE decision with its own ADR.

Conformance: `packages/net/src/cross-realm/preview-port.test.ts` — large-body
(5×64 KiB) byte-for-byte round-trip, zero-chunk body, error-mid-stream +
channel recovery, version-mismatch (503 + `console.error`), idle-timer re-arm,
silent-worker idle 502, seq-gap 502, dispose-mid-stream 502. The four
pre-existing round-trip tests now exercise the streaming path unchanged
(backward-compatible behaviour).

## References

- Q-2026-05-29-001 (OPEN_QUESTIONS.md) — promoted here.
- ADR-0043 (Vite-in-Worker + cross-realm preview bridge), ADR-0017 (net scope /
  streaming rewrite, M12), ADR-0040 (SW frame/routing version split), ADR-0031
  (SW protocol versioning), ADR-0046 (preview owner binding — worker lifecycle).
- `packages/net/src/cross-realm/preview-port.ts`.
