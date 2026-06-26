---
area: toolchain-build
status: shipped
title: TS language service — call hierarchy (prepare / incoming / outgoing calls)
created: 2026-06-22
why: call hierarchy is now exposed from the real TS service for headless/editor clients without inventing a Monaco provider that standalone Monaco does not expose
user_story: As a rifty playground/agent user, I can open a function's call hierarchy and walk its incoming/outgoing calls across my project through the rifty LS client/API
sources: [ADR-0166]
code: [packages/ts-language-service/src/service.ts, packages/ts-language-service/src/worker/protocol.ts, apps/playground/src/glue/ts-ls-monaco-providers.ts]
---

## Context

Landed 2026-06-22: prepare/incoming/outgoing call hierarchy methods are exposed
through the engine, worker protocol, and page client with parity coverage. Monaco
0.52 standalone exposes no public call-hierarchy provider, so UI wiring stops at
the client boundary rather than faking a provider.

This shipped item is retained as the delivery record. The service maps call
hierarchy items and `fromRanges` against the correct source file text, including
cross-file edges, and `long-tail-parity.test.ts` compares prepare/incoming/outgoing
with real TypeScript.

## Verification

- Engine/client API: `prepareCallHierarchy`, `getIncomingCalls`, `getOutgoingCalls`.
- UI ceiling: Monaco 0.52 standalone exposes no public call-hierarchy provider, so
  this remains client/headless-agent surface rather than a fake editor provider.

## Reversibility

REVERSIBLE — additive engine methods + worker frames + playground provider, no
public SDK-shape change beyond more LSP-typed returns. Recorded here; no ADR
(extends ADR-0166's already-Accepted phased scope).
