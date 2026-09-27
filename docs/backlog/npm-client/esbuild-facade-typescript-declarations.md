---
area: npm-client
status: draft
title: The synthesized esbuild facade ships the real `lib/main.d.ts` and `types` entry like esbuild@0.28.0
created: 2026-09-27
why: real esbuild publishes `types: lib/main.d.ts`; the facade materializes `bin/esbuild`, `lib/main.cjs`, `package.json` only, so `import from 'esbuild'` loses types in the IDE with no error and no compat row — while the sass page records its identical gap as ❌
user_story: As a developer editing `scripts/build.ts` with `import { build } from 'esbuild'` in a rifty project, I want the same declarations `tsc` sees on real Node, but today the installed `esbuild` package has no `types` and the language service falls back to implicit any
epic: honest-substitution-signals
sources: [ADR-0371, ADR-0361, docs/public/compat/esbuild-js-api.md, docs/public/compat/sass-embedded.md, docs/backlog/npm-client/reference/shadow-registry-retro-intake-evidence.md]
code: [tools/shadow-registry/src/internal/catalog-source.ts, tools/compat-matrix-generator/cli.js, packages/ts-language-service/src/host.ts]
---

## Context

Finding (observed on `99fdf6c91`): `ESBUILD_ALIAS_PACKAGE`
(`tools/shadow-registry/src/internal/catalog-source.ts:36-48`) declares
`main`/`module`/`exports`/`bin` and no `types`; the recipe's facade files
(:481-485) are `bin/esbuild`, `lib/main.cjs`, `package.json`. The exact twin
`esbuild-wasm@0.28.0`, which since PR #289 rides the installed tree as an
ordinary registry package (ADR-0371), ships `"types": "lib/main.d.ts"` and the
file (`node_modules/.pnpm/esbuild-wasm@0.28.0/node_modules/esbuild-wasm/lib/`:
`main.d.ts`, `browser.d.ts`). Real `esbuild@0.28.0` publishes the same
`lib/main.d.ts`. `docs/public/compat/esbuild-js-api.md` has no declarations
row; `sass-embedded.md:23` records "TypeScript declaration surface ❌" for the
sass facade (ADR-0344) — the two twins hold different honesty standards.

Resolution shape matters: the facade `package.json` declares
`exports: { '.': { import, require, default } }` (:44-46) with no `types`
condition, while real `esbuild@0.28.0` publishes `main` + `types` and no
`exports` at all (`node_modules/.pnpm/esbuild@0.28.0/node_modules/esbuild/package.json`
:12-13; its `lib/main.d.ts` is byte-identical to esbuild-wasm's per `cmp`).
Under `moduleResolution: node16|bundler` a
top-level `types` is ignored when `exports` exists — the fix must either add
a `types` condition or mirror the real package shape, and the proof must run
both classic and `exports`-aware resolution.

Decision (user, 2026-09-27): ship the declarations (parity), not a ❌ row —
recorded in the goal (`honest-substitution-signals` §Decisions). Carrier is
agent-owned: a facade file whose bytes are the twin's `lib/main.d.ts` at
materialization, or a `types` path into the installed twin — decided at pickup
by ADR-0371 (twins carry bytes) and a TS resolution probe. Acceptance shape
expected at pickup: installed `node_modules/esbuild/package.json` `types` +
declaration bytes identical to the twin's; `tsc`-equivalent resolution proof;
compat row.

Related, not a duplicate: `toolchain-build/ts-language-service-types-package-fallback`
covers `@types/*` resolution in the in-browser service; whether the service
resolves a package's own `types` entry is a fog line on the goal map and may
make the IDE half `blocked_by` that item.

Dedup: no title/`code:`/map/declined match.

## Challenge

<!-- finding capture — no premise critic at draft (README §Challenge) -->
