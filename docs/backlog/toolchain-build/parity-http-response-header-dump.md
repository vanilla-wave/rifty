---
area: toolchain-build
status: active
title: Parity http mode — dump full response status+headers+body, not stdout-only
created: 2026-06-12
why: all three ADR-0130 http bugs (204 body, content-length, chunked) are response-framing bugs invisible to the current http parity driver, which exposes only {status, statusText, contentType, body}
sources: [ADR-0130, fullstack-demo feedback 2026-06-12]
code: [tools/node-parity-runner/src/run-in-node.ts, tools/node-parity-runner/src/run-in-rifty.ts, tools/node-parity-runner/cases/http]
---
## Context
Parity runner already has `kind: 'http'` (`__riftyHttpRequest(port, path, init)` — Node side rides real `http.request`, rifty side `dispatchToPort` + fetch `Request`). But the driver normalizes the response to `{status, statusText, contentType, body}` — every header except `content-type` is dropped. ADR-0130 bugs #4 (`net/http/response.ts` 204-body throw) and #6 (`request.ts` honest `transfer-encoding: chunked` presentation) sit exactly in the dropped set and are reachable at this surface. Honest limits: (a) bug #5 (`service-worker/route-preview.ts` content-length re-derivation) is SW-realm — parity runner can never reach it; belongs to `toolchain-build/worker-realm-conformance-harness` / e2e. (b) rifty side rides fetch `Response`, which decodes chunked transparently — raw framing diffs are partially invisible; what IS comparable: header *presence/values* as the server emitted them and body bytes.

## Options / Next
Extend driver result to full header dump: lowercased, sorted, volatile set dropped via explicit allowlist/denylist (`date`, `connection`, `keep-alive` — Node socket adds these by design, fetch path doesn't; keep the denylist visible in the case output contract, not silently inside the driver). Add cases pinning the fixed bugs: 204/304 → no body, no `content-length`; POST echo → `content-length` correct; bodied request without `content-length` → server still reads body (express.json/typeis path). Each is a regression pin for an already-shipped fix — cheap, immediate.

## Reversibility
REVERSIBLE — harness extension + cases. Volatile-header denylist is the provisional call this item records.
