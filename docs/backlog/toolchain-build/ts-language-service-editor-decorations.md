---
area: toolchain-build
status: parked
title: TS language service — editor-decoration surface (inlay hints, document highlights, semantic highlighting)
created: 2026-06-22
why: ADR-0166 ships the tsserver core (diagnostics→formatting) but the editor-decoration surface is the long tail — Monaco's built-in inlay-hints/highlights are retired (task 2.2c) and the LS exposes NO replacement
user_story: As a rifty playground/agent user, I want inline parameter/type inlay hints, same-symbol occurrence highlights on cursor, and project-accurate semantic token colours, but today the LS has no method for them and Monaco's built-ins are turned OFF — so the editor shows none of these, decorated only by the lexer's coarse syntactic colours
sources: [ADR-0166]
code: [packages/ts-language-service/src/service.ts, packages/ts-language-service/src/worker/protocol.ts, apps/playground/src/components/EditorHost.tsx, apps/playground/src/glue/ts-ls-monaco-providers.ts]
---

## Context

ADR-0166 §Scope defers semantic highlighting (and the related decoration surface).
`EditorHost.tsx` (task 2.2c) `setModeConfiguration`s OFF the built-in
`inlayHints`/`documentHighlights` on `typescriptDefaults`/`javascriptDefaults` —
an HONEST absence (no competing lie), but the LS exposes no `provideInlayHints` /
`getDocumentHighlights` / classification method to replace them, so these
decorations simply don't appear.

## Options or Next

Honest acceptance (NO partial delivery): when taken up, MUST deliver ALL of —
- Inlay hints from the real `ts.LanguageService.provideInlayHints(fileName, span, prefs)`
  → LSP `InlayHint[]` (parameter-name + type hints, honoring the prefs), wired as a
  Monaco inlay-hints provider.
- Document highlights from `getDocumentHighlights(fileName, position, filesToSearch)`
  → LSP `DocumentHighlight[]` (read/write kinds), wired as a Monaco
  document-highlight provider.
- Semantic highlighting from `getEncodedSemanticClassifications` /
  `getEncodedSyntacticClassifications` (the 2020 encoded format) → LSP semantic
  tokens (legend + encoded data), wired as a Monaco semantic-tokens provider.
- Parity vs the real `ts.LanguageService` (gold standard, same vendored TS both
  sides) for each: hint label+position+kind, highlight spans+kinds, and the encoded
  classification stream — asserted IDENTICAL to tsc's over a typed fixture.
- Any sub-feature the engine cannot honestly support throws
  `NotImplementedError('ts-language-service.<feature>')`, never an empty decoration
  set that silently lies.

## Reversibility

REVERSIBLE — additive engine methods + worker frames + playground providers, no
public SDK-shape change beyond more LSP-typed returns. Recorded here; no ADR
(extends ADR-0166's already-Accepted phased scope).
