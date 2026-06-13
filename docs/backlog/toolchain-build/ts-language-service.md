---
area: toolchain-build
status: parked
title: In-browser TS language service over VFS (diagnostics/hover/defs)
created: 2026-06-13
why: M12 AI-IDE wants an agent `typecheck` tool + real editor squiggles; needs TS SEMANTIC diagnostics in-browser, distinct from the existing esbuild type-STRIP transform
sources: [M12, docs/research/open-webcontainers-alternative-2026-06.md, docs/backlog/playground/problems-tab-bottom-panel.md, docs/backlog/runtime-js/ts-strip-transform-cache.md]
---

## Context

rifty strips TS types on import (esbuild.wasm) but has no SEMANTIC layer — no type
errors, hover types, go-to-def. M12's agent edits code blind without it; the editor
has no real squiggles. `typescript` is pure JS and its Language Service runs in a
Worker (Monaco / vscode.dev / `@typescript/vfs` precedent), host reading the rifty
VFS. One service feeds BOTH an agent `typecheck`/`hover`/`goto` tool AND the
`playground/problems-tab-bottom-panel`. AI-agnostic — a reusable rifty capability,
not an agent concern.

## Options or Next

- `LanguageServiceHost` over the VFS: tsconfig load, `lib.d.ts`, module resolution.
- Run in a Worker; expose `getSemanticDiagnostics` / `getQuickInfo` / `getDefinitionAtPosition`.
- Scope TS/JS only (the Node-stack target); other-language LSP (native servers) is a browser ceiling, out of scope.
- The agent's `typecheck` tool BINDING lives on the AI side (M12 harness), not here.

## Reversibility

IRREVERSIBLE when taken up — new external dep (`typescript` + `@typescript/vfs`) plus
a new public capability surface. Needs its own ADR.
