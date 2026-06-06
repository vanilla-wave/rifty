# ADR 0033: File budget removed; structure over size

Status: Accepted (2026-05-26)
Date: 2026-05

## Context

ADR-0024 set a 300-line file-size budget, enforced by `tools/checks/file-budget.mjs` via `pnpm check:budget` in CI, to keep files comprehensible by forcing a split past 300 lines.

Six months of evidence: the rule produced shallow modules, not deep ones. Splits were driven by line count, not concept; the result is sibling files so coupled that reading one requires opening the others side-by-side:

- `packages/io/src/buffer-prototype-{core,int,extra}.ts` — three `install*Methods(BufferClass)` wrappers, each with the same preamble and `BufferLikeCtor` shim. `buffer.ts` imports and calls all three; no API line between them — a lexical split.
- `packages/runtime-wasi/src/syscalls/{env,fd,path,proc,clock,shared}.ts` — eight files scattering one surface (the WASI syscall set), all sharing the memory-view and error-code helpers in `shared.ts`. Crossing syscall families needs four files open at once.
- `packages/runtime-js/src/module-loader/esm-ast{,-walker,-scope}.ts` — three files for one transform. `esm-ast.ts` exports `transformEsm`; the others are internal helpers used only from it (the scope file feeds the walker).

ADR-0024 gave no guidance on *how* to split, only that splitting was required, so the cheapest cut won (group by name prefix) rather than the one that reveals structure. Comprehension is a function of cohesion (one purpose) and coupling (reading it needs reading others); line count is a weak cohesion proxy and an inverse coupling proxy when the split is forced.

## Decision

Drop the line-count cap. File length is not enforced; reviewers evaluate cohesion and coupling per PR.

Split-by-concept stays: one purpose per file; single-consumer helpers live with their consumer; multi-consumer helpers earn their own file. The test is "would I open this in a second window to read the consumer", not "is this over N lines".

## Consequences

- `tools/checks/file-budget.mjs` deleted.
- `pnpm check:budget` removed from root `package.json` `scripts`.
- `pnpm check:budget` removed from the `lint-and-typecheck` job in `.github/workflows/ci.yml`.
- ADR-0024 is superseded.
- Cited forced splits merged back in companion changes: buffer-prototype trio → `packages/io/src/buffer-prototype.ts`; esm-ast trio → `packages/runtime-js/src/module-loader/esm-ast.ts`. The WASI scatter is folded back by its owning agent (separate scope).
- Negative: review burden shifts to humans, no automated backstop. Mitigation: non-cohesive long files surface at PR review like any other quality issue.
- Negative: no automated nudge when a file drifts into a god-module. Mitigation: ADR-0012 drew the package boundaries; cross-cutting drift surfaces there.
