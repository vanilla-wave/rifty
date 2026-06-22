---
area: playground
status: blocked
title: Editor hover/completion still served by Monaco's built-in TS worker (not the rifty LS)
created: 2026-06-22
why: P1.9 moved only DIAGNOSTICS to the rifty LS; Monaco's bundled TS worker still serves hover/completion from an isolated lib.d.ts-only model — an approximation that diverges from real tsc (ADR-0166 explicitly rejects such a "stub that lies"), kept transiently until the LS exposes hover/completion providers
user_story: As a rifty playground user, I want hover types and autocompletion to reflect my real project (tsconfig + installed node_modules + cross-file types) like VSCode, but today hover/completion come from Monaco's built-in TS worker which only sees lib.d.ts (no VFS/tsconfig/node_modules), so they disagree with the rifty squiggles and miss project/dependency types
sources: [ADR-0166]
code: [apps/playground/src/components/EditorHost.tsx, apps/playground/src/glue/monaco-env.ts]
---

## Context

`disableBuiltinTsDiagnostics()` (EditorHost.tsx) sets `noSemanticValidation`/`noSyntacticValidation` on Monaco's `typescriptDefaults`+`javascriptDefaults`, so DIAGNOSTICS are the rifty LS's alone. But Monaco's bundled `ts.worker` (`monaco-env.ts`) is still wired and `setModeConfiguration` is never narrowed → Monaco still provides **hover, completion, signature-help, etc.** from its own in-memory model (lib.d.ts only; no VFS, no tsconfig, no node_modules). This is the very "isolated approximation that lies" ADR-0166 rejected — accepted only as a TRANSIENT phase state, recorded loudly here (not hidden).

Blocked on ADR-0166 phase 2 (the LS exposing hover/go-to-def/completions providers).

## Options or Next

When phase 2 lands: register rifty-LS-backed Monaco providers (`registerHoverProvider`/`registerCompletionItemProvider`/`registerDefinitionProvider`/…) over the `rifty:ts-lsp` relay, AND narrow Monaco's built-in worker via `setModeConfiguration({completionItems:false, hovers:false, definitions:false, …})` (or drop the `ts.worker` entirely) so the built-in approximation no longer competes. Until then, hover/completion are Monaco's approximation, not rifty's real types.

## Reversibility

REVERSIBLE — config + provider registration in `apps/playground`; no provisional code in `packages/`. Recorded here; closed by ADR-0166 phase 2.
