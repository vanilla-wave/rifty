---
area: toolchain-build
status: shipped
title: In-browser TS language service over VFS (diagnostics/hover/defs)
created: 2026-06-13
why: M12 AI-IDE wants an agent `typecheck` tool + real editor squiggles; needs TS SEMANTIC diagnostics in-browser, distinct from the existing esbuild type-STRIP transform
user_story: As a rifty maintainer wiring the M12 agent IDE, I have real `typescript` Language Service diagnostics/hover/goto and the rest of the browser-achievable TS editor surface over the authoritative VFS
sources: [ADR-0166, M12, docs/research/open-webcontainers-alternative-2026-06.md, docs/backlog/runtime-js/ts-strip-transform-cache.md]
code: [packages/ts-language-service/src/service.ts]
---

## Context

Landed 2026-06-22: umbrella closed. Core + long-tail TS LS surfaces now have
engine wrappers, worker frames, page-client methods, parity coverage, and Monaco
providers wherever Monaco 0.52 exposes a provider API. Workspace TypeScript
version loading is covered by ADR-0169; the one-click playground TypeScript
preset is shipped.

CORE DELIVERED under ADR-0166 — kept as the umbrella closure record.
`@riftydev/ts-language-service` is a real `ts.LanguageService`
in a kernel worker over the rifty VFS (tsconfig load, `lib.*.d.ts`, module
resolution), LSP-shaped, parity-checked head-to-head vs the real
`ts.LanguageService` (gold standard, same selected `typescript` compiler both sides) and
wired as real Monaco providers in the playground — Monaco's built-in TS
intelligence is retired for every delivered query. Compat:
`docs/public/compat/ts-language-service.md`.

Delivered (✅/⚠️ in the compat matrix): diagnostics (semantic / syntactic /
tsconfig-config), hover, go-to-definition + type-definition, completions (+resolve),
find-references, rename (+prepareRename), signature-help, quick-fixes/code-actions,
organize-imports, document + range formatting, refactors (+interactive args),
move-to-file suggestions, navigation tree + navigation bar, folding, workspace
symbols, inlay hints, document highlights, semantic/syntactic classifications,
call hierarchy, on-type formatting, implementation, suggestion/compiler-options
diagnostics, definition links, fix-all, file-rename edits, selection ranges, file
references, JSX close tag, linked editing, paste-with-imports, JSDoc templates,
TODO comments, name/dotted spans, breakpoint spans, brace matching, indentation,
comment toggles, emit output, supported-code-fix inventory, and clone-safe TS
query preferences/options/result metadata for the implemented APIs. The originally-cited
`playground/problems-tab-bottom-panel` item shipped with task 1.9.

The reusable capability feeds BOTH the playground editor AND an M12 agent
`typecheck`/`hover`/`goto` tool (the agent BINDING lives on the AI side, not here).
TS/JS only — other-language LSP (native servers) is a browser ceiling, out of scope.

## Hard Ceiling

Hard ceiling reached for the shipped/claimed `ts.LanguageService` text/edit/query
surface, except the explicit parked refinements below. Those parked items are not
✅ claims:

- `toolchain-build/ts-language-service-inlay-label-parts` — visible inlay hints
  are real and preference-faithful, but interactive `displayParts` metadata is
  not serialized yet.
- `toolchain-build/ts-language-service-encoded-classification-format` — Monaco
  uses TS 2020 encoded classifications; encoded default/original-format parity
  for non-Monaco callers is parked.
- `playground/ts-refactor-interactive-ui` — refactor metadata/arguments are
  exposed, but the Monaco UI applies only text-only non-interactive refactors
  until a custom prompt/post-edit-rename flow exists.

True ceilings:

- `applyCodeActionCommand` — TS uses this for package-install side effects
  (`InstallPackageAction`), not VFS text edits. rifty exposes a loud
  `NotImplementedError`; code-fix/refactor/completion text edits are implemented.
- `getProgram` / `getCompletionEntrySymbol` / completion `includeSymbol` — TS
  returns live compiler `Program`/`Symbol` object graphs that are not
  structured-clone-safe across the worker protocol. rifty exposes loud
  feature-tagged `NotImplementedError`s instead of serializing fake stand-ins.
- Code lens — editor convenience, not a `ts.LanguageService` primitive.
- Non-TS/JS LSP — native language servers are a browser ceiling and out of scope.

## Reversibility

IRREVERSIBLE core (taken up) — new `typescript` prod dep + new public capability
surface, recorded in ADR-0166. The shipped long tail was REVERSIBLE-additive over
that API.
