---
area: toolchain-build
status: shipped
title: TS language service — use project's installed TypeScript version (workspace version)
created: 2026-06-22
why: v1 vendors a fixed `typescript` for deterministic parity (ADR-0166 D-a); ecosystem-faithful editors (VSCode) default to the workspace TS version — diagnostics/quickinfo must match the version the project actually pins
user_story: As a rifty playground/agent user whose project pins `typescript@X` in node_modules, the language service type-checks with version X; projects without TypeScript get an actionable missing-dependency error, not a fallback compiler
sources: [ADR-0166, ADR-0177]
code: [packages/ts-language-service/src/lib-dts.ts]
---

## Context

Landed 2026-06-22 via ADR-0169 and tightened 2026-06-26 via ADR-0177: the LS
loads `node_modules/typescript/lib/typescript.js` and adjacent `lib/*.d.ts` from
the project VFS, requires that package to exist, and fails loudly when it is
missing or cannot load.

This shipped item is retained as the workspace-version delivery record. Workspace
TypeScript is loaded only when the project has a present, valid compiler package;
missing and broken packages both fail loudly instead of silently falling back.

## Verification

- `long-tail-parity.test.ts` copies the installed TypeScript package into the VFS,
  verifies the workspace compiler/lib path is used, and verifies missing/broken
  workspace compiler packages reject with explicit errors.

## Reversibility

IRREVERSIBLE — changes which compiler/version backs a public capability
(observable behavior) and the parity contract. ADR-0177 records the current
contract and supersedes ADR-0169.
