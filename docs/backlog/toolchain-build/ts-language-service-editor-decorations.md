---
area: toolchain-build
status: shipped
title: TS language service — editor-decoration surface (inlay hints, document highlights, semantic highlighting)
created: 2026-06-22
why: inlay hints, document highlights, and TS semantic classifications are now served by the real VFS-backed TypeScript service
user_story: As a rifty playground/agent user, I get inline parameter/type hints, same-symbol occurrence highlights, and project-accurate semantic token colours from the rifty LS path
sources: [ADR-0166]
code: [packages/ts-language-service/src/service.ts, packages/ts-language-service/src/worker/protocol.ts, apps/playground/src/components/EditorHost.tsx, apps/playground/src/glue/ts-ls-monaco-providers.ts]
---

## Context

Landed 2026-06-22: inlay hints, document highlights, semantic
classifications, and syntactic classifications are exposed and parity-covered;
Monaco providers are wired for inlay hints, highlights, and semantic tokens.

This shipped item is retained as the delivery record. The LS exposes the real
TypeScript inlay-hint, document-highlight, semantic-classification, and
syntactic-classification APIs. Monaco providers use the rifty pipeline; semantic
tokens use TS 2020 classification encoding.

Caveats are explicit: inlay labels currently flatten TS `displayParts` to a
string (`toolchain-build/ts-language-service-inlay-label-parts`), and encoded
semantic classifications expose the Monaco-needed TS 2020 path while
default/original encoded-format parity is parked
(`toolchain-build/ts-language-service-encoded-classification-format`).

## Verification

- `long-tail-parity.test.ts` compares hint label/position/kind, highlight spans,
  and encoded classification streams against real TS.
- `tests/e2e/ts-language-service.spec.ts` drives the registered Monaco provider
  path for semantic tokens through the playground hook.

## Reversibility

REVERSIBLE — additive engine methods + worker frames + playground providers, no
public SDK-shape change beyond more LSP-typed returns. Recorded here; no ADR
(extends ADR-0166's already-Accepted phased scope).
