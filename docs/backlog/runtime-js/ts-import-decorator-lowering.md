---
area: runtime-js
status: shipped
title: TS-on-import decorator lowering (esbuild flag vs acorn plugin vs gap)
created: 2026-06-08
why: shipped — TS-on-import now lowers standard decorators before the runtime ESM pass, matching the `tsx` parity reference
user_story: As a developer importing a `.ts` file that uses a standard `@decorator`, I want it to run like `tsx`; rifty now routes the esbuild transform with decorator lowering before acorn parses the stripped ESM
sources: [docs/public/compat/modules.md]
---
## Context

Landed 2026-06-22: the WASI esbuild transform accepts
`supported.decorators=false`, and the TS-on-import parity runner uses it so
standard decorators lower before the AST ESM pass. Coverage:
`modules/ts-standard-decorator.case.ts` against the real `tsx` reference, plus
`modules/ts-effect-syntax-cross-file.case.ts` for import type / const enum /
interface / enum / satisfies stripping.

This closes the previous acorn parse failure: rifty no longer lets stage-3
decorator syntax leak into the post-strip ESM parser for standard decorator
inputs.
## Reversibility
Reversible — the shipped behavior is local to the `tools/` parity harness +
`transformSource` config, not a cross-package API. The esbuild dependency was
already vendored; no ADR contradiction.
