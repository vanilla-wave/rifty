---
area: toolchain-build
status: draft
title: lightningcss gets a generated compat page like esbuild and sass-embedded
created: 2026-09-27
why: lightningcss is the third builtin substitution (`lightningcss → lightningcss-wasm@1.32.0`, semver-admits) but has zero mentions in `docs/public`, so a user hitting `NotImplementedError('lightningcss.version')` or a transform failure has no claim surface
user_story: As a developer whose Vite config sets `css.transformer: 'lightningcss'`, I want the compat matrix to tell me what rifty's lightningcss substitution admits and lacks, but today only esbuild and sass-embedded have pages and lightningcss appears nowhere in `docs/public/compat`
epic: honest-substitution-signals
sources: [ADR-0361, ADR-0371, docs/public/compat/README.md, docs/backlog/playground/vite8-lightningcss-wasm-init.md, docs/backlog/npm-client/reference/shadow-registry-retro-intake-evidence.md]
code: [tools/compat-matrix-generator/cli.js, docs/public/compat/README.md, tools/shadow-registry/src/internal/catalog-source.ts]
---

## Context

Finding (observed on `99fdf6c91`): `grep -rl lightningcss docs/public` → no
file. `docs/public/compat/README.md` indexes esbuild-js-api and sass-embedded
pages as "the public claim surface for rifty compatibility — treat missing
areas as undocumented, not supported"; the generator
(`tools/compat-matrix-generator/cli.js`) renders esbuild (:128) and sass
(policy JSON, :11) inventories only. The catalog recipe
`rifty.shadow-substitution.lightningcss.v2`
(`tools/shadow-registry/src/internal/catalog-source.ts:491-520`, trigger
`lightningcss@1.32.0`, admission `semver-admits`, acquisition
`lightningcss-wasm@1.32.0`, facade `index.cjs`/`index.mjs`/`package.json`
whose sources are the `LIGHTNINGCSS_ALIAS_*` constants at :52-79)
is covered by npm-client contract tests (recipe-v2 replay/acquisition/
embedded-source/materialized-bin authorities, `installer-shadow-shims.test.ts`)
but publishes no claim.

The page must record observed behavior, not a promise: the open finding
`playground/vite8-lightningcss-wasm-init` (2026-06-21) reports the shim
re-exports `lightningcss-wasm` without calling its async `init()`, so
`transform` may fail with a low-level wasm error. Whether that still holds on
main is established at pickup (probe); the row is ⚠️/❌ with the cited test
until a repair item flips it. Repairing the shim is that item's work, not this
page's.

Expected: a generated `lightningcss` page under `docs/public/compat/` (inventory in the
generator, cited tests existence-checked like the sibling pages, README index
line), stating the admitted request form (`semver-admits` on exact 1.32.0),
the twin, the facade surface, and every loud gap (`lightningcss.version`,
CLI/bin if any).

Dedup: no title/`code:`/map/declined match; `process-meta/compat-matrix-coverage-debt`
covers node-builtins and shell dimensions, not substitutions.

## Challenge

<!-- finding capture — no premise critic at draft (README §Challenge) -->
