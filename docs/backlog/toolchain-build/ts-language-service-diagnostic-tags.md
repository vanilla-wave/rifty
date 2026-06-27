---
area: toolchain-build
status: draft
title: TS language service diagnostic tags and related info
created: 2026-06-26
why: Diagnostics claim parity while LSP/Monaco drops TS relatedInformation and unused/deprecated tags.
user_story: As a TS project user, I want unused/deprecated diagnostics and related spans to render like VS Code, but today rifty only exposes range/message/code/severity.
sources: [PR76 review A1, ADR-0166]
code: [packages/ts-language-service/src/service.ts, packages/ts-language-service/src/lsp-types.ts, apps/playground/src/glue/ts-ls-monaco-providers.ts, packages/ts-language-service/src/parity.test.ts]
---

## Context

`toLspDiagnostic` currently emits only range/severity/message/code/source. The LSP wire type has no `relatedInformation` or tags slot, Monaco marker mapping hardcodes no diagnostic tags, and parity normalization strips those fields from the gold side too. Until this ships, the compat row stays `⚠️`.

## Options or Next

Plumb TS `relatedInformation`, `reportsUnnecessary`, and `reportsDeprecated` through the LSP `Diagnostic` type, worker protocol/client, and Monaco marker conversion. Add parity coverage that de-normalizes diagnostics so gold and rifty both assert related information plus `DiagnosticTag.Unnecessary` / `DiagnosticTag.Deprecated`.

## Reversibility

REVERSIBLE — recorded as this backlog item until implemented.
