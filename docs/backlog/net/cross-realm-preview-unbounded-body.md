---
area: net
status: parked
title: Cross-realm preview bridge drains any non-SSE unbounded body forever (guard keys only on text/event-stream)
created: 2026-06-14
why: serveCrossRealmPreview's SSE guard fires only on text/event-stream; a non-SSE unending body (chunked log-tail, NDJSON feed, hanging-GET) still drains to completion and the page never resolves — the same silent never-delivery, just without the SSE label
user_story: As a dev whose rifty-previewed app streams an unending non-SSE body (an NDJSON event feed or a never-closing chunked log-tail) through the cross-realm worker bridge, I want it to fail loud — but today only text/event-stream is guarded, so any other unbounded body buffers until end (which never comes) and the page hangs silently.
sources: [feature-07-ws-sse-bridge T3/Risks, ADR-0048, ADR-0017]
---
## Context
ADR-0048: the page↔worker hop is buffered-until-`reply-stream-end` (true end-to-end `ReadableStream` is M12, ADR-0017). `serveCrossRealmPreview` (preview-port.ts) now refuses `text/event-stream` bodies (fail loud, 502 naming the ceiling) — but content-type is a narrow proxy for "unending". Any other body that never ends still hits the buffered `arrayBuffer()` / streaming drain loop and the page accumulator never resolves. The SW-bridge path (`@riftydev/service-worker` body-transport.ts `drainStream`) has the analogous gap in a no-transfer realm. Uncommon (most non-SSE bodies terminate), so scoped out of the SSE-ceiling fix.

## Options / Next
Either bound the drain itself (size/time cap that fails loud when exceeded — covers ANY unending body, both bridges) or extend the guard to a transport-level "unbounded" signal (e.g. no content-length + no termination) rather than media-type matching. True end-to-end streaming (resolve-on-start with a live `ReadableStream`) is the M12 fix that removes the ceiling entirely (ADR-0017); this ticket is the loud-fail stopgap until then.

## Reversibility
Reversible — a localized drain cap / guard extension in packages/net (and optionally packages/service-worker); no cross-package API change. The M12 streaming rewrite that supersedes it is IRREVERSIBLE (versioned wire contract).
