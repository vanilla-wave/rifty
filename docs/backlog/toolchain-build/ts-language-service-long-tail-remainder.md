---
area: toolchain-build
status: shipped
title: TS language service — remaining achievable ts.LanguageService surface (go-to-implementation, suggestion diagnostics, fix-all, …)
created: 2026-06-22
why: a full audit of the vendored/workspace `ts.LanguageService` interface closed the remaining browser-achievable editor/agent surface and recorded the true hard ceilings explicitly
user_story: As a rifty playground/agent user, I can use the browser-achievable tsserver editor surface — implementation, suggestions, fix-all, file rename edits, selection/file refs, JSX close/linked-edit, and editor helpers — with remaining non-browser/non-API ceilings called out loudly
sources: [ADR-0166, docs/public/compat/ts-language-service.md]
code: [packages/ts-language-service/src/service.ts, packages/ts-language-service/src/worker/protocol.ts, packages/ts-language-service/src/worker/service-endpoint.ts, apps/playground/src/glue/ts-ls-client.ts, apps/playground/src/glue/ts-ls-monaco-providers.ts]
---

## Context

Landed 2026-06-22: the achievable residual surface is closed: implementation,
suggestion/compiler-options diagnostics, definition links, fix-all, file-rename
edits, selection ranges, file references, JSX close tag, linked editing, paste
edits, JSDoc templates, and TODO comments are all exposed and parity-covered.
Clone-safe TypeScript query preferences/options and result metadata are threaded
through the shipped service/protocol/client surface where the underlying TS API
accepts or returns them: completion-list flags/global/member/new-identifier
metadata, organize-imports mode, paste `fixId`, and refactor parent/action
metadata are preserved.

This file is retained as the shipped audit record. The LS now exposes the
browser-achievable, serializable `ts.LanguageService` text/edit/query surface
through the engine, worker protocol, and page client, with parity tests against
real TypeScript. Editor-native helpers that TS itself exposes (brace matching,
comment toggles, indentation, enclosing comments, breakpoint spans) are also
wrapped because they are real engine calls, not Monaco guesses.

Explicit parked refinements, not hidden ✅ claims:
`toolchain-build/ts-language-service-inlay-label-parts`,
`toolchain-build/ts-language-service-encoded-classification-format`, and
`playground/ts-refactor-interactive-ui`. True hard ceilings remain:
`applyCodeActionCommand` is a package-install side effect and throws
`NotImplementedError('ts-language-service.applyCodeActionCommand')`;
`getProgram`, `getCompletionEntrySymbol`, and completion `includeSymbol` return
live compiler object graphs and throw feature-tagged `NotImplementedError`s over
the protocol; code lens has no `ts.LanguageService` method; non-TS/JS native LSP
is out of scope for this TS package. Compat carries the matching ⚠️/❌ rows.

## Verification

- `packages/ts-language-service/src/long-tail-parity.test.ts` compares navigation,
  decorations, call hierarchy, refactors, formatting, fixes, file refs, selection,
  linked editing, TODOs, emit, workspace TypeScript, and loud ceilings against real
  `ts.LanguageService`.
- `docs/public/compat/ts-language-service.md` is the public hard-ceil inventory:
  every ✅/⚠️ row has implementation/parity coverage plus its caveat; every ❌ row
  is a true browser/API ceiling.

## Reversibility

REVERSIBLE — additive engine methods + worker frames + playground providers, no
public SDK-shape change beyond more LSP-typed returns. Recorded here; no ADR
(extends ADR-0166's already-Accepted phased scope).
