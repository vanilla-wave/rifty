---
area: toolchain-build
status: parked
title: TS language service — use project's installed TypeScript version (workspace version)
created: 2026-06-22
why: v1 vendors a fixed `typescript` for deterministic parity (ADR-0166 D-a); ecosystem-faithful editors (VSCode) default to the workspace TS version — diagnostics/quickinfo must match the version the project actually pins
user_story: As a rifty playground/agent user whose project pins `typescript@X` in node_modules, I want the language service to type-check with version X (as VSCode "Use Workspace Version" does), but today the LS always runs rifty's vendored version, so diagnostics can differ from what `tsc` in the project would report
sources: [ADR-0166]
code: [packages/ts-language-service/src/lib-dts.ts]
---

## Context

ADR-0166 (D-a) vendors one rifty-pinned `typescript` + `lib.*.d.ts` for v1 — deterministic parity (same version both sides) and stable UX. Real editors use the *workspace* TS version: a project pinning a different `typescript` (newer/older lib, new compiler behavior) will see LS results that diverge from its own `tsc`. The vendored version still honors the project `tsconfig`; only the compiler *version* differs.

## Options or Next

Honest acceptance (no partial delivery): when taken up, MUST deliver ALL of —
- Detect `node_modules/typescript` in the project VFS; load that module's compiler API + its `lib.*.d.ts` (its `lib/`), instead of the vendored set, when present.
- Fall back to the vendored version when no project `typescript` is installed (scratch/REPL projects keep working).
- Optional explicit opt-out/override (mirror VSCode "Use VS Code's Version" vs "Use Workspace Version").
- Parity strategy that survives a variable TS version: parity fixtures pin a `typescript` in the fixture's node_modules and assert the LS uses THAT version's output (gold standard = the fixture's own `tsc`/`ts.LanguageService`), not the vendored one.
- Loud failure if the project's `typescript` cannot be loaded in-browser (no silent fall-through to the vendored version that would lie about the version in use).
- Pre-resolved: how a project-supplied `typescript` (CJS, may touch Node `fs`/`path`) executes under the LS worker — reuse runtime-js, or load it as a plain module; decide before claiming.

## Reversibility

IRREVERSIBLE when taken up — changes which compiler/version backs a public capability (observable behavior) and the parity contract. Recorded here; supersede/extend ADR-0166 when claimed.
