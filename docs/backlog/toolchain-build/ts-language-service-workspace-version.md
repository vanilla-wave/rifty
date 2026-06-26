---
area: toolchain-build
status: shipped
title: TS language service — use project's installed TypeScript version (workspace version)
created: 2026-06-22
why: v1 vendors a fixed `typescript` for deterministic parity (ADR-0166 D-a); ecosystem-faithful editors (VSCode) default to the workspace TS version — diagnostics/quickinfo must match the version the project actually pins
user_story: As a rifty playground/agent user whose project pins `typescript@X` in node_modules, the language service type-checks with version X (as VSCode "Use Workspace Version" does), while projects without TypeScript keep the vendored fallback
sources: [ADR-0166]
code: [packages/ts-language-service/src/lib-dts.ts]
---

## Context

Landed 2026-06-22 via ADR-0169: the LS loads
`node_modules/typescript/lib/typescript.js` and adjacent `lib/*.d.ts` from the
project VFS when present and valid, falls back to the vendored compiler only
when absent, and fails loudly when a present workspace compiler cannot load.

This shipped item is retained as the ADR-0169 delivery record. Workspace
TypeScript is loaded only when the project has a present, valid compiler package;
a broken present package fails loudly instead of silently falling back.

## Verification

- `long-tail-parity.test.ts` copies the installed TypeScript package into the VFS,
  verifies the workspace compiler/lib path is used, and verifies a broken present
  workspace compiler rejects with an explicit error.

## Reversibility

IRREVERSIBLE — changes which compiler/version backs a public capability
(observable behavior) and the parity contract. ADR-0169 records the decision.
