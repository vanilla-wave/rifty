---
area: toolchain-build
status: shipped
title: TS language service — navigation surface (document symbols/outline, folding ranges, workspace symbols)
created: 2026-06-22
why: project-aware navigation is now served by the real TS service instead of Monaco's isolated model
user_story: As a rifty playground/agent user, I can get outline/document symbols, folding ranges, navigation bar items, and workspace symbol search from the actual VFS-backed TypeScript project
sources: [ADR-0166]
code: [packages/ts-language-service/src/service.ts, packages/ts-language-service/src/worker/protocol.ts, apps/playground/src/glue/ts-ls-monaco-providers.ts]
---

## Context

Landed 2026-06-22: document symbols, folding ranges, and workspace symbols are
served by the real `ts.LanguageService` and parity-covered. Monaco gets document
symbols/folding; workspace symbols remain engine/client-only because Monaco 0.52
standalone has no public workspace-symbol provider.

This shipped item is retained as the delivery record. The service exposes real
project document symbols, navigation bar items, folding ranges, and workspace
symbols from `ts.LanguageService`; Monaco uses rifty document-symbol and
folding-range providers where standalone Monaco has matching public hooks.

## Verification

- `long-tail-parity.test.ts` asserts document-symbol tree shape/kinds/ranges,
  navigation bar items, outlining spans, and navigate-to results against real TS.
- UI ceiling: Monaco 0.52 standalone has no public workspace-symbol provider; the
  engine/client API remains available for headless consumers.

## Reversibility

REVERSIBLE — additive engine methods + worker frames + playground providers, no
public SDK-shape change beyond more LSP-typed returns. Recorded here; no ADR
(extends ADR-0166's already-Accepted phased scope).
