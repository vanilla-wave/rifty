# ADR 0033: File budget removed; structure over size

Status: Accepted (2026-05-26)
Date: 2026-05

## Context

ADR-0024 set a 300-line file-size budget enforced by `tools/checks/file-budget.mjs` and the `pnpm check:budget` script wired into CI. The intent was to keep individual files comprehensible by capping their length and forcing a split when they grew.

Six months of evidence in this repo says the rule produced shallow modules rather than deep ones. The split was driven by line count, not by concept, and the resulting modules share so much intent that reading one of them requires opening the others side-by-side:

- `packages/io/src/buffer-prototype-{core,int,extra}.ts` — three sibling files, each an `install*Methods(BufferClass)` wrapper around a prototype-method bundle. Every one carries the same opening preamble explaining the split and the same `BufferLikeCtor` shim. `buffer.ts` imports all three and calls each one immediately after class definition. There is no API line between them; the split was lexical.
- `packages/runtime-wasi/src/syscalls/{env,fd,path,proc,clock,shared}.ts` — eight files scattering one logical surface (the WASI syscall set) across siblings that all share the same memory-view and error-code helpers in `shared.ts`. Navigation across syscall families requires opening four files in parallel.
- `packages/runtime-js/src/module-loader/esm-ast{,-walker,-scope}.ts` — three files implementing one transform. `esm-ast.ts` exports `transformEsm`; the other two are internal helpers used only from `esm-ast.ts`. The walker imports every scope helper; the scope file is meaningful only as input to the walker.

In every case the budget cap forced a split whose only justification was the line count. ADR-0024 added no guidance on how to split — only that splitting was required past 300 lines — so the natural cut was the cheapest one (group methods by name prefix), not the one that revealed structure.

The rule was solving a comprehensibility problem with the wrong metric. Comprehension is a function of cohesion (does this file have one purpose) and coupling (does reading it require reading others). Line count is a weak proxy for cohesion and an inverse proxy for coupling when the split is forced.

## Decision

Drop the line-count cap. File length is not enforced. Cohesion and coupling are evaluated by reviewers per PR.

The split-by-concept principle remains: a file should have one purpose; helpers used by only one consumer live in the same file as the consumer; helpers used by multiple consumers earn their own file. The metric is "would I have to open this in a second window to read the consumer", not "is this over N lines".

## Consequences

- `tools/checks/file-budget.mjs` is deleted.
- `pnpm check:budget` is removed from the root `package.json` `scripts` block.
- The `pnpm check:budget` step is removed from the `lint-and-typecheck` job in `.github/workflows/ci.yml`.
- ADR-0024 is superseded.
- The forced splits cited above are merged back in companion changes: buffer-prototype trio → `packages/io/src/buffer-prototype.ts`; esm-ast trio → `packages/runtime-js/src/module-loader/esm-ast.ts`. The WASI scatter is in a separate scope and folded back by its owning agent.
- Reviewers judge cohesion on each PR; growth past a comfortable reading length is now a discussion in code review, not a CI gate. Negative: review burden shifts onto humans, with no automated backstop. Mitigation: long files that lack cohesion show up as PR-time discussion the same way other quality issues do.
- Negative: no automated nudge when a file accidentally drifts into a god-module. Mitigation: ADR-0012 already drew the package boundaries; cross-cutting drift surfaces at those boundaries.
