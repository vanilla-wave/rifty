---
area: toolchain-build
status: parked
title: TS language service — call hierarchy (prepare / incoming / outgoing calls)
created: 2026-06-22
why: ADR-0166 ships the tsserver core (diagnostics→formatting) but call hierarchy is the long tail — the LS exposes NO method for it
user_story: As a rifty playground/agent user, I want to open the call hierarchy of a function and walk its incoming/outgoing calls across my project, but today the LS has no call-hierarchy method, so the editor offers no "Show Call Hierarchy" and the agent can't trace a call graph
sources: [ADR-0166]
code: [packages/ts-language-service/src/service.ts, packages/ts-language-service/src/worker/protocol.ts, apps/playground/src/glue/ts-ls-monaco-providers.ts]
---

## Context

ADR-0166 §Scope names call hierarchy in the deferred long tail. The engine wraps a
real `ts.LanguageService` but exposes no call-hierarchy surface; `service.ts` has
no prepare/incoming/outgoing method and `worker/protocol.ts` carries no frame for
it. (Monaco has no built-in call-hierarchy, so there is no competing stub — an
honest absence.)

## Options or Next

Honest acceptance (NO partial delivery): when taken up, MUST deliver ALL of —
- Surface the real `ts.LanguageService.prepareCallHierarchy(fileName, position)`,
  `provideCallHierarchyIncomingCalls(fileName, position)`, and
  `provideCallHierarchyOutgoingCalls(fileName, position)`, mapped to LSP
  `CallHierarchyItem` / `CallHierarchyIncomingCall[]` / `CallHierarchyOutgoingCall[]`
  (names, kinds, ranges, fromRanges); wired as a Monaco call-hierarchy provider over
  the page↔owner↔LS relay (CancellationToken re-checked per hop).
- Parity vs the real `ts.LanguageService` (gold standard, same vendored TS both
  sides) for prepare + incoming + outgoing over a multi-file call-graph fixture —
  asserted IDENTICAL to tsc's (item identity, from-ranges, cross-file edges).
- Any sub-case the engine cannot honestly support throws
  `NotImplementedError('ts-language-service.callHierarchy.<case>')`, never an empty
  graph that silently lies about there being no callers/callees.

## Reversibility

REVERSIBLE — additive engine methods + worker frames + playground provider, no
public SDK-shape change beyond more LSP-typed returns. Recorded here; no ADR
(extends ADR-0166's already-Accepted phased scope).
