---
area: toolchain-build
status: parked
title: In-browser TS language service over VFS (diagnostics/hover/defs)
created: 2026-06-13
why: M12 AI-IDE wants an agent `typecheck` tool + real editor squiggles; needs TS SEMANTIC diagnostics in-browser, distinct from the existing esbuild type-STRIP transform
user_story: As a rifty maintainer wiring the M12 agent IDE, I want `getSemanticDiagnostics`/`getQuickInfo`/`getDefinitionAtPosition` over the VFS for a `typecheck`/`hover`/`goto` tool and editor squiggles, but today rifty only type-STRIPS via esbuild.wasm — no `typescript` Language Service, so the agent edits blind and there are no real type errors
sources: [ADR-0166, M12, docs/research/open-webcontainers-alternative-2026-06.md, docs/backlog/runtime-js/ts-strip-transform-cache.md]
code: [packages/ts-language-service/src/service.ts]
---

## Context

CORE DELIVERED under ADR-0166 — kept as an umbrella record because a long tail
remains (see below). `@riftydev/ts-language-service` is a real `ts.LanguageService`
in a kernel worker over the rifty VFS (tsconfig load, `lib.*.d.ts`, module
resolution), LSP-shaped, parity-checked head-to-head vs the real
`ts.LanguageService` (gold standard, same vendored `typescript` both sides) and
wired as real Monaco providers in the playground — Monaco's built-in TS
intelligence is retired for every delivered query. Compat:
`docs/public/compat/ts-language-service.md`.

Delivered (✅ in the compat matrix): diagnostics (semantic / syntactic /
tsconfig-config), hover, go-to-definition + type-definition, completions (+resolve),
find-references, rename (+prepareRename), signature-help, quick-fixes/code-actions,
organize-imports, document + range formatting. The originally-cited
`playground/problems-tab-bottom-panel` item shipped with task 1.9.

The reusable capability feeds BOTH the playground editor AND an M12 agent
`typecheck`/`hover`/`goto` tool (the agent BINDING lives on the AI side, not here).
TS/JS only — other-language LSP (native servers) is a browser ceiling, out of scope.

## Options or Next

The full-tsserver CORE (diagnostics→formatting) is done. The deferred long tail is
each tracked by its own honest item (NO method exposed today — an honest absence,
never a silent stub; ADR-0166 §Scope):

- `toolchain-build/ts-language-service-refactorings` — getApplicableRefactors / getEditsForRefactor (+ Monaco `refactor.*`).
- `toolchain-build/ts-language-service-navigation` — document symbols/outline + folding ranges + workspace symbols.
- `toolchain-build/ts-language-service-editor-decorations` — inlay hints + document highlights + semantic highlighting.
- `toolchain-build/ts-language-service-call-hierarchy` — call hierarchy.
- `playground/ts-ls-on-type-formatting` — on-type formatting (doc + range shipped; on-type not).
- `protocol/ts-completion-resolve-by-label` — same-name auto-import completion-resolve collision (label-only resolve).
- `toolchain-build/ts-language-service-workspace-version` — use the project's installed TS version (VSCode "Use Workspace Version").
- `toolchain-build/ts-language-service-long-tail-remainder` — the rest of the achievable `ts.LanguageService` surface found by a full interface audit: go-to-implementation, suggestion diagnostics, definition-bound-span, fix-all, update-imports-on-rename, selection range, file references, JSX close-tag/linked-editing, paste-with-imports, JSDoc template, TODO comments, compiler-options diagnostics. (Brace matching / comment toggling / indentation are intentionally editor-native, not an LS gap.)

## Reversibility

IRREVERSIBLE core (taken up) — new `typescript` prod dep + new public capability
surface, recorded in ADR-0166. The long tail is REVERSIBLE-additive, tracked by the
items above.
