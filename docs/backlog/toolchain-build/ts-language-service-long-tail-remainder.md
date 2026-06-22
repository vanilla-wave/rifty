---
area: toolchain-build
status: parked
title: TS language service — remaining achievable ts.LanguageService surface (go-to-implementation, suggestion diagnostics, fix-all, …)
created: 2026-06-22
why: a full audit of the vendored `ts.LanguageService` interface vs the shipped + already-tracked surface found a residual set of methods that deliver a real editor/agent feature, are achievable in-browser over the VFS (a pure engine call like every shipped row), yet were NEITHER implemented NOR recorded — an honest-gap rule violation (ADR-0166 §Scope: every gap explicit)
user_story: As a rifty playground/agent user, I want the rest of what tsserver gives an editor — Go to Implementation, the faded "unused/convert-to-async" suggestion squiggles, Fix-All, import fix-up on file rename, expand-selection, Find File References, JSX tag close/linked-edit — but today the LS exposes NO method for them, so the editor falls back to nothing project-aware and the M12 agent can't reach these
sources: [ADR-0166, docs/public/compat/ts-language-service.md]
code: [packages/ts-language-service/src/service.ts, packages/ts-language-service/src/worker/protocol.ts, packages/ts-language-service/src/worker/service-endpoint.ts, apps/playground/src/glue/ts-ls-client.ts, apps/playground/src/glue/ts-ls-monaco-providers.ts]
---

## Context

ADR-0166 shipped the tsserver CORE (diagnostics→formatting) and tracked the big
long-tail buckets (refactorings, inlay hints, document highlights, semantic
highlighting, call hierarchy, navigation/outline/folding/workspace-symbols,
on-type formatting, workspace TS version, completion-resolve collision). A
method-by-method audit of the vendored `ts.LanguageService` interface (the
engine's hard ceiling) against the shipped + tracked surface surfaced a residual
set that was unrecorded. The engine exposes NO method for any of these today
(`worker/protocol.ts` carries no frame; `service.ts` no wrapper) — an honest
absence, now tracked here so NO achievable feature is silent (compat ❌ rows
added). Editor-native lexer features (brace matching, comment toggling,
indentation) are intentionally Monaco's, NOT an LS gap. `getCompletionEntrySymbol`
/ raw `getEmitOutput` / debugger breakpoint spans are out of scope (non-
serializable `ts.Symbol`, the esbuild type-strip path, a non-LSP debugger
primitive respectively).

## Options or Next

Honest acceptance (NO partial delivery within a sub-feature): each below, when
taken up, ships its engine wrapper + worker frame + (where it has a UI surface) a
Monaco provider, and is parity-checked head-to-head vs the real
`ts.LanguageService` (gold standard, same vendored TS both sides) over a real
multi-symbol/multi-file fixture; a sub-feature the engine cannot honestly serve
throws `NotImplementedError('ts-language-service.<feature>')`, never a lying
empty. Grouped by editor+M12-agent value:

**High**
- Go-to-implementation — `getImplementationAtPosition` → LSP `Location[]`, Monaco
  implementation provider (distinct from go-to-definition: interface/abstract →
  concrete impls).
- Suggestion diagnostics — `getSuggestionDiagnostics(fileName)` → LSP `Diagnostic[]`
  at `Hint`/`Information` severity (unused locals, unreachable, "convert to async"),
  folded into the diagnostics pass as the faded squiggles VSCode shows.
- Definition-bound-span — `getDefinitionAndBoundSpan` to enrich the shipped
  go-to-definition with the symbol's `originSelectionRange` (LSP `LocationLink`).

**Medium**
- Fix-all — `getCombinedCodeFix` → apply one fix to every occurrence in a file
  (`source.fixAll`), extending the shipped point quick-fixes.
- Update-imports-on-rename — `getEditsForFileRename(oldPath,newPath)` → cross-file
  `WorkspaceEdit`, wired to the explorer/editor file-rename flow.
- Selection range — `getSmartSelectionRange` → LSP `SelectionRange` (expand/shrink
  by syntax), Monaco selection-range provider.
- File references — `getFileReferences(fileName)` → who imports this file (distinct
  from symbol `findReferences`).
- JSX close-tag + linked editing — `getJsxClosingTagAtPosition` +
  `getLinkedEditingRangeAtPosition` (auto-close + synchronized open/close tag edit).

**Low**
- Paste-with-imports — `preparePasteEditsForFile` + `getPasteEdits` (TS 5.6+).
- JSDoc template — `getDocCommentTemplateAtPosition` (`/** */` → `@param`/`@returns`).
- TODO comments — `getTodoComments`.
- Compiler-options diagnostics — `getCompilerOptionsDiagnostics()` (global option
  errors, distinct from the shipped tsconfig config-file diagnostics).

## Reversibility

REVERSIBLE — additive engine methods + worker frames + playground providers, no
public SDK-shape change beyond more LSP-typed returns. Recorded here; no ADR
(extends ADR-0166's already-Accepted phased scope). Each sub-feature is
independently shippable; the umbrella `toolchain-build/ts-language-service`
points here for the remainder.
