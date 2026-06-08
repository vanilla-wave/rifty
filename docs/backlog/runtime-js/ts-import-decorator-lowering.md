---
area: runtime-js
status: parked
title: TS-on-import decorator lowering (esbuild flag vs acorn plugin vs gap)
created: 2026-06-08
why: esbuild leaves stage-3 @decorator un-lowered and the post-strip acorn parse rejects it; left as a documented gap
sources: [docs/public/compat/modules.md]
---
## Context
The `transformSource` esbuild WASI hook (`--loader=ts`, no tsconfig) erases/lowers `import type`/`const enum`/`interface`/`enum`/`satisfies` identically to the Node-side `tsx` reference (parity case `modules/ts-effect-syntax-cross-file`). Decorators are the exception: esbuild leaves stage-3 `@decorator` UN-lowered (passthrough) and rifty's post-strip acorn parse (`ecmaVersion:'latest'`, no decorators plugin) throws SyntaxError — while `tsx` fully lowers them. opencode's vendored source uses NO decorators (grep-verified), so not a boot blocker — a real pipeline asymmetry. NOTE block in the case file + docs/public/compat/modules.md Known-limitations; compat row is ⚠️.
## Options / Next
Chosen (provisional): A — leave as a documented gap; add real support only when a target pkg needs decorators. Alts: B pass esbuild a tsconfig enabling `experimentalDecorators` (or stage-3 transform) to lower before acorn — closes it at the natural seam but `experimentalDecorators`-vs-stage-3 semantics differ (wrong choice silently miscompiles) and needs a per-flavour parity case; C acorn decorators plugin — parses but does NOT lower, strictly worse than B. Close via B against a concrete decorator-using package.
## Reversibility
Reversible — gap is in the `tools/` parity harness + `transformSource` config, not a cross-package API. Closing = a one-line esbuild arg + one parity case (<2 files); esbuild already vendored. No dep, no ADR contradiction.
