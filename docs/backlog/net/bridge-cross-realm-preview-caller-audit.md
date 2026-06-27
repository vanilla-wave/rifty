---
area: net
status: draft
title: Audit in-repo callers of bridgeCrossRealmPreview before v3 ships (resolve-on-end → resolve-on-start)
created: 2026-06-08
why: v3 changes resolution semantics; a caller assuming a fully-buffered Response on resolve breaks silently
user_story: As a maintainer about to cut the v3 preview frame bump, I want every `bridgeCrossRealmPreview` call site checked for `.arrayBuffer()`-on-a-buffered-`Response` assumptions before resolve flips to resolve-on-start — can't yet, no caller audited so the v3 cutover risks a silent stream regression.
sources: [feature-07-ws-sse-bridge T5/Risks, ADR-0048, ADR-0017]
---
## Context
feature 07's v3 page↔Worker frame bump (`PREVIEW_PORT_FRAME_VERSION` 2→3) changes `bridgeCrossRealmPreview` (preview-port.ts:301) from resolve-on-`reply-stream-end` to resolve-on-`reply-stream-start` with a live `ReadableStream` body. Any in-repo caller assuming the `Response` is fully buffered when it resolves (e.g. `.arrayBuffer()` expecting completeness) breaks. The bump is gated behind v3 negotiation, but an unaudited caller is a silent regression. Must be audited BEFORE feature-07 T5 ships.

## Context (gate)
Blocked: depends on the v3 frame-bump ADR (feature-07 Decision 2) being ratified and T5 starting; the audit is the pre-flight for that work, not standalone net work.

## Options / Next
Next (when v3 work starts): `rg bridgeCrossRealmPreview` across the repo; for each call site verify it does not assume a buffered Response at resolve time; flag/fix any that do before the v2→v3 cutover. Pure audit + targeted fixes.

## Reversibility
REVERSIBLE — an audit + small caller fixes. The v3 bump it precedes is IRREVERSIBLE (versioned wire contract, needs a decision subagent + superseding ADR). Parked behind the v3 ratification gate.
