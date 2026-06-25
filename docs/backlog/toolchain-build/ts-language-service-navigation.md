---
area: toolchain-build
status: parked
title: TS language service — navigation surface (document symbols/outline, folding ranges, workspace symbols)
created: 2026-06-22
why: ADR-0166 ships the tsserver core (diagnostics→formatting) but the navigation surface is the long tail — the LS exposes NO method for outline/folding/workspace-symbols
user_story: As a rifty playground/agent user, I want a file Outline (breadcrumbs + symbol tree), code folding by structure, and Cmd-T workspace symbol search across my project, but today the LS has no navigation method, so the editor falls back to nothing project-aware (or Monaco's lib.d.ts-only built-in) and the agent can't enumerate a file's symbols
sources: [ADR-0166]
code: [packages/ts-language-service/src/service.ts, packages/ts-language-service/src/worker/protocol.ts, apps/playground/src/glue/ts-ls-monaco-providers.ts]
---

## Context

ADR-0166 §Scope leaves the navigation surface deferred. The engine exposes no
`getNavigationTree`/`getNavigationBarItems`, no folding, no project-wide symbol
search; `worker/protocol.ts` carries no frame for them. (Monaco's syntactic
`documentSymbols` is the one built-in still left ON in task 2.2c — a lib.d.ts/model
approximation, not the VFS-backed project view, so outline/folding/workspace are
NOT honestly served today.)

## Options or Next

Honest acceptance (NO partial delivery): when taken up, MUST deliver ALL of —
- Document symbols / outline from the real `ts.LanguageService.getNavigationTree(fileName)`
  (or `getNavigationBarItems`) → LSP `DocumentSymbol[]` (hierarchical, with kinds +
  selection ranges), wired as a Monaco document-symbol provider; and retire the last
  built-in `documentSymbols` so rifty owns it (no competing approximation).
- Folding ranges from `getOutliningSpans(fileName)` → LSP `FoldingRange[]`, wired as a
  Monaco folding-range provider.
- Workspace symbols from `getNavigateToItems(searchValue, …)` across the project →
  LSP `SymbolInformation[]`, wired as a Monaco workspace-symbol provider.
- Parity vs the real `ts.LanguageService` (gold standard, same vendored TS both
  sides) for each: outline tree shape+kinds+ranges, outlining spans, and navigate-to
  hits — asserted IDENTICAL to tsc's, over a multi-symbol + multi-file fixture.
- Any sub-feature the engine cannot honestly support throws
  `NotImplementedError('ts-language-service.<feature>')`, never an empty/partial list
  that lies about there being no symbols.

## Reversibility

REVERSIBLE — additive engine methods + worker frames + playground providers, no
public SDK-shape change beyond more LSP-typed returns. Recorded here; no ADR
(extends ADR-0166's already-Accepted phased scope).
